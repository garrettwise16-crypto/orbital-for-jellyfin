"""Retain image links supplied by a connected sports provider; never invent artwork."""
from urllib.parse import urlsplit

def image_url(value):
    if not isinstance(value,str) or not value or len(value)>2048:return None
    try:
        u=urlsplit(value)
        return value if u.scheme=='https' and u.hostname and not u.username and not u.password and not u.fragment else None
    except ValueError:return None

def team_logo(team):
    value=image_url(team.get('logo'))
    if value:return value
    return next((url for row in team.get('logos',[]) if isinstance(row,dict) and (url:=image_url(row.get('href')))),None)
