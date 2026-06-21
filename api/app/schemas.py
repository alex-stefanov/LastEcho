"""Pydantic models describing the API's response shapes.

These mirror the frontend's `LangRecord` / `Meta` types exactly, and double as
the OpenAPI schema shown at /docs. Validating the dataset against these on load
means a malformed artifact fails fast at startup rather than mid-request.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel

DocLevel = Literal["none", "wordlist", "grammar sketch", "full grammar"]
Vitality = Literal["alive", "atRisk", "lost"]

# --- outreach (the "response layer") ---------------------------------------
# Institutions are hand-verified (regional/continental/global, from
# institutions.json) or auto-discovered live from a language's lat/lng
# (national, via reverse-geocoding + the ROR registry) — confidence is always
# labeled, never presented as equally certain.
InstitutionScope = Literal["regional", "national", "continental", "global"]
InstitutionConfidence = Literal["verified", "auto-discovered"]

# The escalation ladder a language climbs if institutions don't reply:
# local (regional-or-national match) -> continental -> global. Collapses the
# Institution.scope regional/national distinction into one rung, since both
# are "the most local real option we found."
OutreachTier = Literal["local", "continental", "global"]

# pending_review/approved/rejected: the existing human approval gate.
# sent/replied/no_reply: the admin's own record of what happened after they
# personally sent it — there is no real inbox integration, so these are
# manually set by the admin, not auto-detected. no_reply is what unlocks
# escalation to the next tier.
DraftStatus = Literal["pending_review", "approved", "rejected", "sent", "replied", "no_reply"]


class Institution(BaseModel):
    id: str
    name: str
    type: str
    scope: InstitutionScope
    confidence: InstitutionConfidence
    regions: list[str] = []
    families: list[str] = []
    continents: list[str] = []
    countries: list[str] = []
    helpTypes: list[str] = []
    url: str
    contactUrl: str
    email: Optional[str] = None
    blurb: str


class InstitutionsFile(BaseModel):
    institutions: list[Institution]


# A real, emailable language organization from language_organizations.json.
# Unlike the hand-verified institutions (whose `email` is usually null), every
# org here has a deliverable address, so these are the entries the send endpoint
# can actually transmit to. `cc` is the ISO alpha-2 country code, reverse-geocoded
# from the coordinates once at load time so matching never re-resolves it.
class Organization(BaseModel):
    name: str
    email: str
    city: str
    country: str
    latitude: float
    longitude: float
    cc: Optional[str] = None


class OutreachDraft(BaseModel):
    id: int
    languageId: int
    institutionId: str
    tier: OutreachTier
    subject: str
    body: str
    ask: str
    status: DraftStatus
    createdAt: str
    decidedAt: Optional[str] = None
    sentAt: Optional[str] = None
    canEscalate: bool = False
    # Denormalized so the admin view (a separate page, no shared state with
    # the public app) doesn't need a second round-trip per draft.
    languageName: str
    institutionName: str
    institutionUrl: str
    institutionContactUrl: str
    institutionEmail: Optional[str] = None


class DraftUpdate(BaseModel):
    subject: Optional[str] = None
    body: Optional[str] = None
    institutionEmail: Optional[str] = None


class OutreachStatusSummary(BaseModel):
    hasPending: bool
    hasApproved: bool
    hasRejected: bool
    hasSent: bool
    hasReplied: bool
    canEscalate: bool  # sent, unanswered, and past the escalate_after_days window
    currentTier: Optional[OutreachTier] = None
    institutionCount: int


class TriageRunResult(BaseModel):
    drafted: int
    skipped: int
    escalated: int


class Meta(BaseModel):
    minYear: int
    maxYear: int
    today: int


class Language(BaseModel):
    id: int
    name: str
    lat: float
    lng: float
    family: str
    region: str
    speakers: int
    docLevel: DocLevel
    rank: int
    # Closed-form vitality profile; null means "never declines" / "never lost".
    declineStart: Optional[int] = None
    lostYear: Optional[int] = None


class LanguagesResponse(BaseModel):
    meta: Meta
    languages: list[Language]


class Health(BaseModel):
    status: str
    count: int
