import argparse
import re
import sys
from typing import Any, Dict, List, Optional, Tuple

import mysql.connector
import requests


OFFICIAL_DATASETS = (
    "elcat_sql_2018",
    "elcat_cldf_2023",
    "elcat_cldf_2024",
)


def connect(args):
    return mysql.connector.connect(
        host=args.host,
        port=args.port,
        user=args.user,
        password=args.password,
        database=args.database,
        charset="utf8mb4",
    )


def column_exists(conn, table: str, column: str) -> bool:
    cur = conn.cursor()
    cur.execute(
        """
        SELECT COUNT(*)
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = %s
          AND COLUMN_NAME = %s
        """,
        (table, column),
    )
    exists = cur.fetchone()[0] > 0
    cur.close()
    return exists


def ensure_column(conn, table: str, column: str, definition: str):
    if not column_exists(conn, table, column):
        cur = conn.cursor()
        cur.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
        conn.commit()
        cur.close()
        print(f"Added column: {table}.{column}")


def ensure_enrichment_columns(conn):
    ensure_column(conn, "language_core_year", "risk_detail_group", "VARCHAR(100) NULL")
    ensure_column(conn, "language_core_year", "data_gap_type", "VARCHAR(100) NULL")
    ensure_column(conn, "language_core_year", "external_source_url", "VARCHAR(500) NULL")


def update_unknown_and_risk_types(conn):
    cur = conn.cursor()

    cur.execute(
        """
        UPDATE language_core_year
        SET risk_detail_group =
            CASE
                WHEN risk_group = 'lost' THEN 'lost'

                WHEN risk_group = 'alive' THEN 'alive'

                WHEN LOWER(COALESCE(risk_level_raw, '')) LIKE '%critically%' THEN 'at_risk_critical'
                WHEN LOWER(COALESCE(risk_level_raw, '')) LIKE '%severely%' THEN 'at_risk_severe'
                WHEN LOWER(COALESCE(risk_level_raw, '')) LIKE '%endangered%' THEN 'at_risk_endangered'
                WHEN LOWER(COALESCE(risk_level_raw, '')) LIKE '%threatened%' THEN 'at_risk_threatened'
                WHEN LOWER(COALESCE(risk_level_raw, '')) LIKE '%vulnerable%' THEN 'at_risk_vulnerable'
                WHEN LOWER(COALESCE(risk_level_raw, '')) LIKE '%at risk%' THEN 'at_risk_general'

                WHEN risk_group = 'at_risk' AND speakers_estimate IS NULL THEN 'at_risk_no_speaker_count'
                WHEN risk_group = 'at_risk' THEN 'at_risk_unspecified'

                WHEN risk_group = 'unknown'
                     AND (risk_level_raw IS NULL OR TRIM(risk_level_raw) = '')
                     AND speakers_estimate IS NULL
                     THEN 'unknown_no_risk_no_speakers'

                WHEN risk_group = 'unknown'
                     AND (risk_level_raw IS NULL OR TRIM(risk_level_raw) = '')
                     AND speakers_estimate IS NOT NULL
                     THEN 'unknown_no_risk_has_speakers'

                WHEN risk_group = 'unknown'
                     AND risk_level_raw IS NOT NULL
                     AND TRIM(risk_level_raw) <> ''
                     AND speakers_estimate IS NULL
                     THEN 'unknown_unmapped_risk_no_speakers'

                WHEN risk_group = 'unknown'
                     AND risk_level_raw IS NOT NULL
                     AND TRIM(risk_level_raw) <> ''
                     AND speakers_estimate IS NOT NULL
                     THEN 'unknown_unmapped_risk_has_speakers'

                ELSE 'unknown_other'
            END
        """
    )

    cur.execute(
        """
        UPDATE language_core_year
        SET data_gap_type =
            CASE
                WHEN speakers_estimate IS NULL
                     AND (latitude IS NULL OR TRIM(latitude) = '')
                     AND (longitude IS NULL OR TRIM(longitude) = '')
                     AND (family_root IS NULL OR TRIM(family_root) = '')
                     THEN 'missing_speakers_location_family'

                WHEN speakers_estimate IS NULL
                     AND ((latitude IS NULL OR TRIM(latitude) = '')
                          OR (longitude IS NULL OR TRIM(longitude) = ''))
                     THEN 'missing_speakers_and_location'

                WHEN speakers_estimate IS NULL THEN 'missing_speakers'

                WHEN (latitude IS NULL OR TRIM(latitude) = '')
                     OR (longitude IS NULL OR TRIM(longitude) = '')
                     THEN 'missing_location'

                WHEN family_root IS NULL OR TRIM(family_root) = '' THEN 'missing_family'

                ELSE 'complete_core_fields'
            END
        """
    )

    conn.commit()
    cur.close()
    print("Updated risk_detail_group and data_gap_type.")


def create_one_per_iso_view(conn):
    cur = conn.cursor()

    cur.execute("DROP VIEW IF EXISTS vw_core_one_per_iso_official")

    cur.execute(
        f"""
        CREATE VIEW vw_core_one_per_iso_official AS
        SELECT *
        FROM (
            SELECT
                l.*,
                ROW_NUMBER() OVER (
                    PARTITION BY snapshot_year, iso_code
                    ORDER BY
                        speakers_estimate DESC,
                        name ASC,
                        id ASC
                ) AS rn
            FROM language_core_year l
            WHERE iso_code IS NOT NULL
              AND TRIM(iso_code) <> ''
              AND source_dataset IN {OFFICIAL_DATASETS}
        ) x
        WHERE rn = 1
        """
    )

    conn.commit()
    cur.close()
    print("Created vw_core_one_per_iso_official.")


def create_change_summary(conn):
    cur = conn.cursor()

    cur.execute("DROP TABLE IF EXISTS language_change_summary")

    cur.execute(
        """
        CREATE TABLE language_change_summary AS
        SELECT
            iso.iso_code,

            COALESCE(l24.name, l23.name, l18.name) AS name,

            l18.speakers_estimate AS speakers_2018,
            l23.speakers_estimate AS speakers_2023,
            l24.speakers_estimate AS speakers_2024,

            l18.risk_group AS risk_2018,
            l23.risk_group AS risk_2023,
            l24.risk_group AS risk_2024,

            l18.risk_detail_group AS risk_detail_2018,
            l23.risk_detail_group AS risk_detail_2023,
            l24.risk_detail_group AS risk_detail_2024,

            COALESCE(l24.family_root, l23.family_root, l18.family_root) AS family_root,
            COALESCE(l24.family_path, l23.family_path, l18.family_path) AS family_path,

            COALESCE(l24.latitude, l23.latitude, l18.latitude) AS latitude,
            COALESCE(l24.longitude, l23.longitude, l18.longitude) AS longitude,

            l23.speakers_estimate - l18.speakers_estimate AS speakers_change_2018_2023,
            l24.speakers_estimate - l23.speakers_estimate AS speakers_change_2023_2024,
            l24.speakers_estimate - l18.speakers_estimate AS speakers_change_2018_2024,

            ROUND(
                ((l24.speakers_estimate - l18.speakers_estimate)
                / NULLIF(l18.speakers_estimate, 0)) * 100,
                2
            ) AS speakers_change_percent_2018_2024,

            CASE
                WHEN l18.iso_code IS NULL AND l24.iso_code IS NOT NULL
                    THEN 'new_in_2024'

                WHEN l18.iso_code IS NOT NULL AND l24.iso_code IS NULL
                    THEN 'missing_in_2024'

                WHEN l18.speakers_estimate IS NULL OR l24.speakers_estimate IS NULL
                    THEN 'not_enough_speaker_data'

                WHEN l18.risk_group = 'at_risk'
                     AND COALESCE(l24.risk_group, '') <> 'at_risk'
                     AND ((l24.speakers_estimate - l18.speakers_estimate)
                          / NULLIF(l18.speakers_estimate, 0)) >= 0.5
                    THEN 'large_increase_and_no_longer_at_risk'

                WHEN l18.risk_group = 'at_risk'
                     AND COALESCE(l24.risk_group, '') <> 'at_risk'
                    THEN 'no_longer_at_risk_or_reclassified'

                WHEN ((l24.speakers_estimate - l18.speakers_estimate)
                      / NULLIF(l18.speakers_estimate, 0)) >= 0.5
                    THEN 'large_increase'

                WHEN ((l24.speakers_estimate - l18.speakers_estimate)
                      / NULLIF(l18.speakers_estimate, 0)) <= -0.5
                    THEN 'large_decrease'

                WHEN l18.risk_group <> l24.risk_group
                    THEN 'risk_changed'

                ELSE 'stable_or_small_change'
            END AS change_type

        FROM (
            SELECT DISTINCT iso_code
            FROM vw_core_one_per_iso_official
            WHERE iso_code IS NOT NULL
              AND TRIM(iso_code) <> ''
        ) iso

        LEFT JOIN vw_core_one_per_iso_official l18
            ON l18.iso_code = iso.iso_code
           AND l18.snapshot_year = 2018

        LEFT JOIN vw_core_one_per_iso_official l23
            ON l23.iso_code = iso.iso_code
           AND l23.snapshot_year = 2023

        LEFT JOIN vw_core_one_per_iso_official l24
            ON l24.iso_code = iso.iso_code
           AND l24.snapshot_year = 2024
        """
    )

    cur.execute("ALTER TABLE language_change_summary ADD INDEX ix_lcs_iso (iso_code)")
    cur.execute("ALTER TABLE language_change_summary ADD INDEX ix_lcs_change_type (change_type)")
    cur.execute("ALTER TABLE language_change_summary ADD INDEX ix_lcs_family (family_root)")

    conn.commit()
    cur.close()
    print("Created language_change_summary.")


def parse_wikidata_point(value: str) -> Tuple[Optional[str], Optional[str]]:
    if not value:
        return None, None

    match = re.match(r"Point\\(([-0-9.]+)\\s+([-0-9.]+)\\)", value)
    if not match:
        return None, None

    longitude = match.group(1)
    latitude = match.group(2)
    return latitude, longitude


def fetch_wikidata_live_languages(min_speakers: int, limit: int) -> List[Dict[str, Any]]:
    endpoint = "https://query.wikidata.org/sparql"

    query = f"""
    SELECT ?item ?itemLabel ?iso ?speakers ?glottocode ?familyLabel ?coord WHERE {{
      ?item wdt:P220 ?iso ;
            wdt:P1098 ?speakers .

      FILTER(STRLEN(?iso) = 3)
      FILTER(?speakers >= {min_speakers})

      OPTIONAL {{ ?item wdt:P1394 ?glottocode . }}
      OPTIONAL {{
        ?item wdt:P279 ?family .
        ?family rdfs:label ?familyLabel .
        FILTER(LANG(?familyLabel) = "en")
      }}
      OPTIONAL {{ ?item wdt:P625 ?coord . }}

      SERVICE wikibase:label {{
        bd:serviceParam wikibase:language "en" .
      }}
    }}
    ORDER BY DESC(?speakers)
    LIMIT {limit}
    """

    headers = {
        "Accept": "application/sparql-results+json",
        "User-Agent": "LastEchoLanguageResearchPrototype/0.1",
    }

    response = requests.get(
        endpoint,
        params={"query": query, "format": "json"},
        headers=headers,
        timeout=60,
    )
    response.raise_for_status()

    data = response.json()
    rows = []

    for binding in data["results"]["bindings"]:
        iso = binding.get("iso", {}).get("value")
        name = binding.get("itemLabel", {}).get("value")
        speakers = binding.get("speakers", {}).get("value")
        glottocode = binding.get("glottocode", {}).get("value")
        family = binding.get("familyLabel", {}).get("value")
        item_url = binding.get("item", {}).get("value")
        coord = binding.get("coord", {}).get("value")

        latitude, longitude = parse_wikidata_point(coord)

        if not iso or not name or not speakers:
            continue

        try:
            speakers_int = int(float(speakers))
        except ValueError:
            continue

        rows.append(
            {
                "name": name,
                "iso_code": iso,
                "speakers_estimate": speakers_int,
                "speakers_raw": str(speakers_int),
                "glottocode": glottocode,
                "family_root": family,
                "family_path": family,
                "latitude": latitude,
                "longitude": longitude,
                "coordinates_raw": coord,
                "external_source_url": item_url,
            }
        )

    return rows


def iso_exists_in_official_data(conn, iso_code: str) -> bool:
    cur = conn.cursor()
    cur.execute(
        f"""
        SELECT COUNT(*)
        FROM language_core_year
        WHERE iso_code = %s
          AND source_dataset IN {OFFICIAL_DATASETS}
        """,
        (iso_code,),
    )
    exists = cur.fetchone()[0] > 0
    cur.close()
    return exists


def insert_wikidata_live_languages(conn, rows: List[Dict[str, Any]], years: List[int], allow_existing_iso: bool):
    cur = conn.cursor()

    inserted = 0
    skipped_existing = 0

    insert_sql = """
        INSERT INTO language_core_year (
            snapshot_year,
            source_dataset,
            language_key,
            name,
            iso_code,
            speakers_raw,
            speakers_estimate,
            latitude,
            longitude,
            coordinates_raw,
            risk_level_raw,
            risk_group,
            classification_raw,
            family_root,
            family_path,
            risk_detail_group,
            data_gap_type,
            external_source_url
        )
        VALUES (
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s
        )
        ON DUPLICATE KEY UPDATE
            name = VALUES(name),
            speakers_raw = VALUES(speakers_raw),
            speakers_estimate = VALUES(speakers_estimate),
            latitude = VALUES(latitude),
            longitude = VALUES(longitude),
            coordinates_raw = VALUES(coordinates_raw),
            risk_level_raw = VALUES(risk_level_raw),
            risk_group = VALUES(risk_group),
            classification_raw = VALUES(classification_raw),
            family_root = VALUES(family_root),
            family_path = VALUES(family_path),
            risk_detail_group = VALUES(risk_detail_group),
            data_gap_type = VALUES(data_gap_type),
            external_source_url = VALUES(external_source_url)
    """

    for row in rows:
        iso = row["iso_code"]

        if not allow_existing_iso and iso_exists_in_official_data(conn, iso):
            skipped_existing += 1
            continue

        for year in years:
            source_dataset = "wikidata_live_external"
            language_key = f"wikidata:{iso}"

            cur.execute(
                insert_sql,
                (
                    year,
                    source_dataset,
                    language_key,
                    row["name"],
                    row["iso_code"],
                    row["speakers_raw"],
                    row["speakers_estimate"],
                    row["latitude"],
                    row["longitude"],
                    row["coordinates_raw"],
                    "external_current_speaker_count_alive_candidate",
                    "alive",
                    row["family_root"],
                    row["family_root"],
                    row["family_path"],
                    "alive_external",
                    "external_source_core_fields",
                    row["external_source_url"],
                ),
            )
            inserted += 1

    conn.commit()
    cur.close()

    print(f"Inserted/updated external live rows: {inserted}")
    print(f"Skipped because ISO already exists in official ELCat data: {skipped_existing}")


def print_summary(conn):
    cur = conn.cursor()

    print("\nRisk detail groups:")
    cur.execute(
        """
        SELECT snapshot_year, risk_detail_group, COUNT(*)
        FROM language_core_year
        GROUP BY snapshot_year, risk_detail_group
        ORDER BY snapshot_year, COUNT(*) DESC
        """
    )
    for row in cur.fetchall():
        print(row)

    print("\nChange types:")
    cur.execute(
        """
        SELECT change_type, COUNT(*)
        FROM language_change_summary
        GROUP BY change_type
        ORDER BY COUNT(*) DESC
        """
    )
    for row in cur.fetchall():
        print(row)

    cur.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="localhost")
    parser.add_argument("--port", type=int, default=3306)
    parser.add_argument("--user", default="root")
    parser.add_argument("--password", required=True)
    parser.add_argument("--database", default="languages_production")

    parser.add_argument("--add-wikidata-live", action="store_true")
    parser.add_argument("--min-speakers", type=int, default=1_000_000)
    parser.add_argument("--limit", type=int, default=300)
    parser.add_argument("--years", nargs="+", type=int, default=[2024])
    parser.add_argument("--allow-existing-iso", action="store_true")

    args = parser.parse_args()

    conn = connect(args)

    try:
        ensure_enrichment_columns(conn)
        update_unknown_and_risk_types(conn)
        create_one_per_iso_view(conn)
        create_change_summary(conn)

        if args.add_wikidata_live:
            print("\nFetching external live-language candidates from Wikidata...")
            rows = fetch_wikidata_live_languages(args.min_speakers, args.limit)
            print(f"Fetched rows: {len(rows)}")

            insert_wikidata_live_languages(
                conn=conn,
                rows=rows,
                years=args.years,
                allow_existing_iso=args.allow_existing_iso,
            )

            update_unknown_and_risk_types(conn)
            create_one_per_iso_view(conn)
            create_change_summary(conn)

        print_summary(conn)

    finally:
        conn.close()


if __name__ == "__main__":
    main()