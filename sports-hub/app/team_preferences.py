"""Authenticated account preferences. SQLite transactions prevent lost updates."""
import json
import os
import re
import sqlite3
from contextlib import closing
from pathlib import Path

DB = Path(os.environ.get('TEAM_PREFERENCES_DB', '/preferences/teams.sqlite3'))
LEAGUES = {'MLB', 'NFL', 'College football', 'NBA', 'WNBA', 'NHL'}

def normalize(teams):
    if not isinstance(teams, list) or len(teams) > 12:
        raise ValueError('Choose up to 12 teams')
    result = []
    for t in teams:
        if not isinstance(t, dict): raise ValueError('Invalid team')
        league, sep, tid = str(t.get('key', '')).partition('~')
        if league not in LEAGUES or not sep or not re.fullmatch(r'[0-9]{1,12}', tid):
            raise ValueError('Invalid team identity')
        name = t.get('name')
        if not isinstance(name, str) or not 1 <= len(name) <= 160:
            raise ValueError('Invalid team name')
        logos = [u for u in t.get('logos', []) if isinstance(u,str) and u.startswith('https://a.espncdn.com/') and len(u) < 512][:1]
        clean = {'key':league+'~'+tid,'id':tid,'league':league,'name':name,'logos':logos}
        if not any(x['key']==clean['key'] for x in result): result.append(clean)
    return result

def access(user, body=None):
    # Caller supplies the authenticated /Users/Me ID, never a body/query account.
    if not re.fullmatch(r'[a-fA-F0-9-]{32,36}', str(user)): raise ValueError('Invalid account')
    user = user.replace('-', '').lower()
    with closing(sqlite3.connect(DB, timeout=3)) as db, db:
        db.execute('CREATE TABLE IF NOT EXISTS teams (account TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL)')
        db.execute('BEGIN IMMEDIATE' if body is not None else 'BEGIN')
        row = db.execute('SELECT revision,payload FROM teams WHERE account=?',(user,)).fetchone()
        current = {'revision':row[0], 'teams':json.loads(row[1])} if row else {'revision':0,'teams':[]}
        if body is None: return 200,current
        if not isinstance(body,dict) or type(body.get('revision')) is not int or body['revision']<0:
            raise ValueError('A revision is required')
        proposed = normalize(body.get('teams'))
        if body.get('migration') is True:
            # Review v2 D04: a device import only seeds an untouched account. Once the account has an
            # accepted revision, a (re)played migration returns it unchanged -- it can never bring back
            # a team the user removed, whatever local flags a device lost or restored.
            if current['revision'] > 0:
                return 200,{**current,'migration':'skipped'}
        elif current['revision'] != body['revision']:
            return 409,{**current,'error':'Teams changed on another device. Review and save again.'}
        if proposed == current['teams']: return 200,current
        result = {'revision':current['revision']+1,'teams':proposed}
        db.execute('INSERT OR REPLACE INTO teams VALUES (?,?,?)',(user,result['revision'],json.dumps(proposed)))
        return 200,result
