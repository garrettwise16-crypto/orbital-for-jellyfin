"""Original, pure integration policy; no I/O and no vendor mutation methods.

Adapters must supply current authorized evidence. These contracts are executable
reference components, NOT proof that the live clients currently call them.
"""
from __future__ import annotations
from dataclasses import dataclass
from enum import IntEnum
from collections.abc import Iterable, Mapping
from itertools import islice
from experience import Fault, digest, item_id, integer, text, segment_decision

class SeerrRequestStatus(IntEnum):
    PENDING=1; APPROVED=2; DECLINED=3; FAILED=4; COMPLETED=5

class SeerrMediaStatus(IntEnum):
    UNKNOWN=1; PENDING=2; PROCESSING=3; PARTIALLY_AVAILABLE=4; AVAILABLE=5; BLOCKLISTED=6; DELETED=7

# Explicitly separate upstream wire codes. Never feed one enum into the other.
def enum_name(enum, value):
    if type(value) is not int: return 'unknown'
    try: return enum(value).name.lower()
    except ValueError: return 'unknown'

@dataclass(frozen=True)
class PlaybackEvidence:
    item: str
    source_revision: str
    observed_at: int
    expires_at: int
    outcome: str  # rendered, failed, or unknown; not a catalogue label

    def fresh_for(self, item: str, revision: str, now: int) -> bool:
        return (self.item == item and self.source_revision == revision and self.outcome == 'rendered'
                and type(self.observed_at) is int and type(self.expires_at) is int
                and self.observed_at <= now < self.expires_at)

@dataclass(frozen=True)
class AuthorizedCopy:
    """Only construct AFTER caller-token visibility and current play policy checks.

    'play_allowed' permits attempting playback, not a verified picture. Version
    keys are opaque, never provider addresses. One row represents one movie or
    one actual episode, not a placeholder Series container.
    """
    item: str
    source_revision: str
    play_allowed: bool
    has_media: bool
    season: int | None = None
    episode: int | None = None
    duration_ticks: int | None = None
    position_ticks: int | None = None
    evidence: PlaybackEvidence | None = None

    def can_attempt(self): return self.play_allowed is True and self.has_media is True


def request_summary(media_info: Mapping | None, own_requests: Iterable[Mapping], copies: Iterable[AuthorizedCopy],
                    *, requested_seasons: Iterable[int]=(), now: int, quality: str='standard',
                    request_permission: bool=False, globally_existing: bool | None=None,
                    expected_episode_counts: Mapping[int,int] | None=None) -> dict:
    """Normalize Seerr wire data + already-authorized real copies, without leaking requesters.

    own_requests MUST already be scoped by a trusted user-mapping adapter. An
    administrator's global requests feed cannot be passed through to the UI.
    Globally_existing is a sanitized existence result, not identities/records.
    """
    if quality not in {'standard','4k'}: raise Fault(400,'invalid_quality_scope')
    integer(now,0,2**53-1)
    requested=sorted({integer(n,0,1000) for n in requested_seasons})
    info=media_info or {};wire_status=info.get('status4k' if quality=='4k' else 'status')
    status_valid=type(wire_status) is int and wire_status in set(int(v) for v in SeerrMediaStatus)
    status=enum_name(SeerrMediaStatus,wire_status)
    season_field='status4k' if quality=='4k' else 'status'
    upstream_seasons={s['seasonNumber']:enum_name(SeerrMediaStatus,s.get(season_field))
                      for s in info.get('seasons',[]) if isinstance(s,dict) and type(s.get('seasonNumber')) is int}
    states=[]
    # Read no more than a bounded number of scoped records; don't expose upstream prose.
    for req in islice(own_requests,200):
        if req.get('is4k',False) is not (quality=='4k'): continue
        # Request status can be approved while individual season requests differ.
        scoped=req.get('seasons') or []
        relevant=[s for s in scoped if isinstance(s,dict) and s.get('seasonNumber') in requested]
        if requested and scoped and not relevant: continue
        states.extend(enum_name(SeerrRequestStatus,s.get('status')) for s in relevant) if relevant else states.append(enum_name(SeerrRequestStatus,req.get('status')))
    priority=['failed','declined','pending','approved','completed','unknown']
    request_state=next((s for s in priority if s in states),'none')
    allowed=[c for c in islice(copies,100000) if c.can_attempt()]
    scoped=[c for c in allowed if not requested or c.season in requested]
    verified=[c for c in scoped if c.evidence and c.evidence.fresh_for(c.item,c.source_revision,now)]
    present=sorted({c.season for c in scoped if c.season is not None})
    complete=[]
    counts=expected_episode_counts or {}
    for season in requested:
        actual={c.episode for c in scoped if c.season==season and type(c.episode) is int and c.episode>0}
        # A stable, authoritative expected count is required; a single episode is not a complete season.
        expected=counts.get(season)
        if type(expected) is int and expected>0 and actual==set(range(1,expected+1)): complete.append(season)
    if not scoped: availability='not_in_library'
    elif requested and set(complete)!=set(requested): availability='partial_or_unconfirmed'
    else: availability='in_library'
    existing=globally_existing is True or bool(states) or status in {'pending','processing','partially_available','available'}
    blocked=status=='blocklisted'
    # Unknown global request existence or upstream state never authorizes new acquisition.
    can_request=status_valid and request_permission is True and globally_existing is False and not existing and not blocked and status in {'unknown','deleted'} and not scoped
    return {'schema':1,'upstream_media':status,'own_request':request_state,'availability':availability,
            'can_attempt_playback':bool(scoped),'recently_rendered_items':len(verified),
            'present_seasons':present,'complete_seasons':complete,'requested_seasons':requested,
            'upstream_seasons':{str(k):v for k,v in upstream_seasons.items() if k in requested},
            'can_request':can_request,'automatic_retry':False,
            'request_block': 'blocked_upstream' if blocked else 'already_requested_or_reported_available' if existing else 'unknown_existing_requests' if globally_existing is None else 'permission_or_library_state'}


@dataclass(frozen=True)
class PlaybackContext:
    item: str
    media_source: str
    revision: str
    duration_ticks: int
    seekable: bool
    live: bool

    def key(self) -> str:
        return digest([item_id(self.item),text(self.media_source,128),text(self.revision,128),integer(self.duration_ticks,1,86400*10_000_000)])


def safe_segment_action(context: PlaybackContext, segments_context: str, segments: Iterable[dict],
                        position: int, *, auto_intro=False, dismissed: Iterable[str]=()) -> dict | None:
    """Exact-copy segment decisions; never return a player action for live/nonseekable media."""
    if context.live is not False or context.seekable is not True: return None
    key=context.key()
    if key!=segments_context: return None
    rows=list(islice(segments,257))
    if len(rows)>256: raise Fault(422,'segment_limit')
    action=segment_decision(rows,position,context.duration_ticks,auto_intro)
    if action is None:return None
    action={**action,'id':digest([key,action['id']])[:32],'context':key}
    if action['id'] in set(dismissed):return None
    # Recheck this context immediately before the player executes a returned decision.
    action['requires_context_recheck']=True
    return action


def remaining_runtime(copy: AuthorizedCopy) -> int | None:
    duration,position=copy.duration_ticks,copy.position_ticks
    if not copy.can_attempt() or type(duration) is not int or duration<=0 or type(position) is not int or not 0<=position<=duration:return None
    return duration-position


def fits_time_budget(copy: AuthorizedCopy, minutes: int) -> bool:
    """A useful coupled smart-shelf rule; unknown runtime is not treated as short."""
    integer(minutes,1,1440);remaining=remaining_runtime(copy)
    return remaining is not None and 0<remaining<=minutes*600_000_000


def notification_projection(*, kind: str, item: Mapping, accessible: bool, hidden: bool, episode_protected: bool,
                            sports_protected: bool) -> dict | None:
    """Plain, privacy-minimized text for a future private inbox; no sender or scheduler."""
    if not accessible or hidden:return None
    if kind=='sports' and sports_protected:return {'kind':kind,'title':'A followed game has an update','spoiler_safe':True}
    if kind=='episode' and episode_protected:return {'kind':kind,'title':'A followed series has an update','spoiler_safe':True}
    # Even unprotected notifications do not pass through upstream HTML/URLs/diagnostics.
    name=str(item.get('Name') or 'A saved title')
    name=''.join(c for c in name if c.isprintable())[:140]
    return {'kind':kind,'title':name,'spoiler_safe':False}


def search_decision(*, engine_healthy: bool, index_schema_compatible: bool, index_fresh: bool,
                    external_accessible_ids: Iterable[str], sql_accessible_ids: Iterable[str], limit=40) -> dict:
    """Post-authorization result arbitration, not an installed search engine.

    Avoid treating nonempty GLOBAL matches as a successful user-visible search.
    Adapters must enforce scope for BOTH inputs and never expose global totals.
    """
    integer(limit,1,100)
    use_external=engine_healthy and index_schema_compatible and index_fresh
    external=list(dict.fromkeys(item_id(v) for v in islice(external_accessible_ids,500))) if use_external else []
    if external: return {'ids':external[:limit],'engine':'external','degraded':False}
    sql=list(dict.fromkeys(item_id(v) for v in islice(sql_accessible_ids,500)))
    return {'ids':sql[:limit],'engine':'jellyfin','degraded':not use_external,'reason':'external_unavailable_or_stale' if not use_external else 'no_accessible_external_matches'}


def confidence_rating(score, votes, *, prior=6.5, prior_weight=50) -> dict:
    """Optional transparent ranking estimate, never a replacement metadata rating.

    Prior and weight are configurable product choices, not measured household
    quality facts. No vote count means unknown confidence, not a fabricated zero.
    Different providers/scales must never be combined without normalization.
    """
    import math
    if type(score) not in (int,float) or not math.isfinite(score) or not 0<=score<=10:
        return {'display_score':None,'ranking_score':None,'confidence':'invalid'}
    if type(prior) not in (int,float) or not math.isfinite(prior) or not 0<=prior<=10:
        raise Fault(400,'invalid_rating_prior')
    integer(prior_weight,1,100000)
    if type(votes) is not int or votes<1:
        return {'display_score':float(score),'ranking_score':None,'confidence':'unknown'}
    integer(votes,1,2**53-1)
    rank=(votes*score+prior_weight*prior)/(votes+prior_weight)
    return {'display_score':float(score),'ranking_score':rank,'confidence':'vote_weighted','votes':votes,
            'prior':prior,'prior_weight':prior_weight}
