"""Request-coalesced, bounded, immutable viewer-scoped catalogue observations.

Two consecutive matching scans detect ordinary count/order/metadata churn. This
is NOT a transactional upstream snapshot; response metadata says so explicitly.
Never authorize from this cache. Hydrate item IDs with the caller on every page.
"""
from __future__ import annotations
import copy, threading, time
from collections import OrderedDict
from experience import Fault, digest, item_id

class CatalogCache:
    def __init__(self,ttl=120,max_accounts=4,max_items=100000):
        self.ttl=ttl;self.max_accounts=max_accounts;self.max_items=max_items
        self.lock=threading.RLock();self.cache=OrderedDict();self.building=set()
    def get(self,key,scan,*,force=False):
        with self.lock:
            now=time.monotonic();entry=self.cache.get(key)
            if entry and entry['expires']>now and not force:return copy.deepcopy(entry)
            if key in self.building:raise Fault(429,'catalogue_refresh_in_progress')
            if len(self.building)>=1:raise Fault(429,'catalogue_busy')
            self.building.add(key)
        try:
            previous=None;accepted=None
            # 3 scans maximum, require two consecutive equal observations.
            for _ in range(3):
                rows=scan()
                if not isinstance(rows,list) or len(rows)>self.max_items:raise Fault(422,'catalogue_bound_exceeded')
                ids=[item_id(i.get('Id')) for i in rows]
                if len(ids)!=len(set(ids)):raise Fault(409,'catalogue_changed')
                generation=digest(rows)
                if generation==previous:accepted=rows;break
                previous=generation
            if accepted is None:raise Fault(409,'catalogue_changed')
            entry={'generation':generation,'observed_at':time.time(),'expires':time.monotonic()+self.ttl,
                   'rows':accepted,'consistency':'two_matching_observations_not_transactional'}
            with self.lock:
                self.cache[key]=entry;self.cache.move_to_end(key)
                while len(self.cache)>self.max_accounts:self.cache.popitem(last=False)
            return copy.deepcopy(entry)
        finally:
            with self.lock:self.building.discard(key)
    def invalidate(self,owner):
        with self.lock:
            for key in [k for k in self.cache if k[0]==owner]:self.cache.pop(key,None)
