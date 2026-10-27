"""Bounded GET-only transport for fixed, operator-configured upstreams.

No redirects, environment proxies, arbitrary hosts, retries, or media reads. DNS
is resolved once, with a bounded wait, at initialization. A request watchdog shuts
its exact socket on the absolute deadline (including trickling headers/bodies).
Only caller-held Jellyfin credentials enter get_json; no token is logged/cached.
"""
from __future__ import annotations
import http.client
import ipaddress
import json
import socket
import ssl
import threading
import time
from urllib.parse import urlsplit
from experience import Fault

class FixedJsonGet:
    def __init__(self, base: str, *, timeout=4.0, max_bytes=8_000_000,
                 header='X-Emby-Token', resolve_timeout=3.0):
        p=urlsplit(base)
        if p.scheme not in ('http','https') or not p.hostname or p.username or p.password or p.query or p.fragment or p.path not in ('','/'):
            raise ValueError('A fixed origin without credentials or path is required')
        if not .05 <= timeout <= 15 or not 1024 <= max_bytes <= 32_000_000:
            raise ValueError('Invalid transport bounds')
        if header not in ('X-Emby-Token','X-Api-Key'):raise ValueError('Unsupported credential header')
        self.base=base.rstrip('/'); self.parsed=p; self.timeout=timeout
        self.max_bytes=max_bytes; self.header=header; self.port=p.port or (443 if p.scheme=='https' else 80)
        self.addresses=[]; self._tls=ssl.create_default_context()
        done=threading.Event(); result=[]
        def resolve():
            try:result.extend(socket.getaddrinfo(p.hostname,self.port,type=socket.SOCK_STREAM))
            except OSError:pass
            finally:done.set()
        try:
            address=ipaddress.ip_address(p.hostname)
            family=socket.AF_INET6 if address.version==6 else socket.AF_INET
            self.addresses=[(family,socket.SOCK_STREAM,0,'',(str(address),self.port))]
        except ValueError:
            # One startup worker only, never a DNS worker per user request.
            threading.Thread(target=resolve,daemon=True,name='experience-resolve').start()
            if not done.wait(resolve_timeout):raise Fault(503,'upstream_resolution_deadline')
            self.addresses=result[:8]
        if not self.addresses:raise Fault(503,'upstream_unresolved')

    def __call__(self,url,credential,*,deadline=None):
        p=urlsplit(url)
        if (p.scheme,p.netloc)!=(self.parsed.scheme,self.parsed.netloc) or p.fragment or p.username or p.password:
            raise Fault(400,'upstream_origin_rejected')
        path=p.path or '/'
        if any(c in path for c in ('\\','\r','\n')) or '%' in path or '..' in path.split('/'):
            raise Fault(400,'upstream_path_rejected')
        # The adapter owns route construction. This transport never opens media.
        if not (path in ('/Sessions','/api/v1/user','/api/v1/search','/api/v1/request','/api/v1/discover/movies','/api/v1/discover/tv') or path.startswith(('/Users/','/Shows/','/Items/','/Persons','/MediaSegments/','/sports/api/catalogue','/api/v1/movie/','/api/v1/tv/','/api/v1/status','/api/v1/user/'))):
            raise Fault(403,'upstream_route_rejected')
        if not isinstance(credential,str) or not 1<=len(credential)<=512 or any(ord(c)<32 for c in credential):
            raise Fault(401,'invalid_credential')
        end=min(deadline or float('inf'),time.monotonic()+self.timeout)
        if end<=time.monotonic():raise Fault(504,'upstream_deadline')
        held=[]; lock=threading.Lock(); expired=threading.Event()
        def abort():
            expired.set()
            with lock:
                for s in held:
                    try:s.shutdown(socket.SHUT_RDWR)
                    except OSError:pass
                    try:s.close()
                    except OSError:pass
        timer=threading.Timer(max(.001,end-time.monotonic()),abort);timer.daemon=True;timer.start()
        connection=None
        try:
            connected=None
            for family,socktype,proto,_,address in self.addresses:
                if expired.is_set():raise Fault(504,'upstream_deadline')
                s=socket.socket(family,socktype,proto)
                with lock:held.append(s)
                try:
                    s.settimeout(max(.001,end-time.monotonic()));s.connect(address);connected=s;break
                except OSError:
                    s.close()
            if connected is None:raise Fault(503,'upstream_connect_failed')
            if self.parsed.scheme=='https':
                connected=self._tls.wrap_socket(connected,server_hostname=self.parsed.hostname)
                with lock:held.append(connected)
            connection=http.client.HTTPConnection(self.parsed.hostname,self.port)
            connection.sock=connected
            target=path+('?' + p.query if p.query else '')
            connection.request('GET',target,headers={self.header:credential,'Accept':'application/json','Accept-Encoding':'identity','Connection':'close'})
            response=connection.getresponse()
            if not 200<=response.status<300:
                error=Fault(response.status if response.status in (401,403,404,429) else 502,'upstream_request_failed')
                error.code_http=response.status
                raise error
            if response.getheader('Content-Encoding','identity').lower() not in ('','identity'):
                raise Fault(502,'unexpected_content_encoding')
            if 'application/json' not in response.getheader('Content-Type','').lower():
                raise Fault(502,'upstream_not_json')
            length=response.getheader('Content-Length')
            if length is not None:
                try:size=int(length)
                except ValueError:raise Fault(502,'upstream_length_invalid') from None
                if not 0<=size<=self.max_bytes:raise Fault(502,'upstream_response_too_large')
            chunks=[];size=0
            while True:
                if expired.is_set() or time.monotonic()>=end:raise Fault(504,'upstream_deadline')
                chunk=response.read1(min(65536,self.max_bytes+1-size))
                if not chunk:break
                size+=len(chunk)
                if size>self.max_bytes:raise Fault(502,'upstream_response_too_large')
                chunks.append(chunk)
            if expired.is_set():raise Fault(504,'upstream_deadline')
            raw=b''.join(chunks)
            if length is not None and len(raw)!=int(length):raise Fault(502,'upstream_truncated')
            try:return json.loads(raw,parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
            except (ValueError,UnicodeError):raise Fault(502,'upstream_invalid_json') from None
        except Fault:raise
        except (OSError,http.client.HTTPException,ValueError):
            raise Fault(504 if expired.is_set() or time.monotonic()>=end else 502,'upstream_deadline' if expired.is_set() or time.monotonic()>=end else 'upstream_transport_failed') from None
        finally:
            timer.cancel()
            if connection:connection.close()
            with lock:
                for s in held:
                    try:s.close()
                    except OSError:pass
