"""Read-only Seerr title adapter; transport and account association must be verified.

No client-supplied Seerr user ID, URL, API key or request permission is accepted.
A trusted host adapter supplies get_json(path), an independently checked account
binding, sanitized global-existence state, and authorized library copies.
The returned structure never forwards an upstream requester or diagnostic.
"""
from dataclasses import dataclass
from collections.abc import Callable, Iterable, Mapping
from experience import Actor, Fault, integer, item_id
from integration_contracts import AuthorizedCopy, request_summary

@dataclass(frozen=True)
class SeerrBinding:
    orbital_server: str
    jellyfin_user: str
    seerr_user: int

    def verify(self, actor: Actor):
        integer(self.seerr_user,1,2**53-1)
        if self.orbital_server!=actor.server or item_id(self.jellyfin_user)!=actor.user:
            raise Fault(403,'request_account_binding_mismatch')

class SeerrReadAdapter:
    def __init__(self,get_json:Callable[[str],Mapping]):
        self.get_json=get_json
    def title(self,actor:Actor,binding:SeerrBinding,media_type:str,tmdb:int,copies:Iterable[AuthorizedCopy],
              *,now:int,requested_seasons=(),quality='standard',expected_episode_counts=None):
        binding.verify(actor)
        if media_type not in {'movie','tv'}:raise Fault(400,'invalid_media_type')
        integer(tmdb,1,2**53-1)
        raw=self.get_json(f'/api/v1/{media_type}/{tmdb}')
        if not isinstance(raw,Mapping) or type(raw.get('id')) is not int or raw['id']!=tmdb:
            raise Fault(502,'seerr_title_identity_mismatch')
        info=raw.get('mediaInfo') or {}
        if not isinstance(info,Mapping):raise Fault(502,'seerr_media_shape')
        # Embedded collections can be incomplete. An empty array is not a global
        # negative-existence proof. Acquisition is always disabled in this adapter.
        requests=info.get('requests',[])
        if not isinstance(requests,list) or len(requests)>200:raise Fault(502,'seerr_request_shape')
        own=[]
        for row in requests:
            if not isinstance(row,dict):continue
            by=row.get('requestedBy') or {}
            if not isinstance(by,Mapping) or type(by.get('id')) is not int or by['id']!=binding.seerr_user:continue
            remote_jf=by.get('jellyfinUserId')
            if remote_jf is not None and item_id(remote_jf)!=actor.user:raise Fault(502,'seerr_owner_identity_mismatch')
            own.append({'status':row.get('status'),'is4k':row.get('is4k',False),'seasons':row.get('seasons',[])})
        result=request_summary(info,own,copies,now=now,quality=quality,requested_seasons=requested_seasons,
                               expected_episode_counts=expected_episode_counts,globally_existing=None,request_permission=False)
        return {**result,'title_identity':{'type':media_type,'tmdb':tmdb},'request_actions_enabled':False}
