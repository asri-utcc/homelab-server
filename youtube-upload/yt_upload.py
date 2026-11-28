#!/usr/bin/env python3
"""YouTube uploader for the video factory (YouTube Data API v3, OAuth desktop flow).

  yt-upload auth                       one-time consent (prints URL, waits on localhost:8765)
  yt-upload whoami                     show the authorised channel
  yt-upload upload VIDEO --title T     upload (PRIVATE unless --privacy is given)

Secrets live outside the repo: ~/.config/lab-social/{youtube_client_secret,youtube_token}.json
"""
import argparse, json, os, sys
from pathlib import Path

CFG = Path.home() / ".config" / "lab-social"
SECRET = CFG / "youtube_client_secret.json"
TOKEN = CFG / "youtube_token.json"
SCOPES = ["https://www.googleapis.com/auth/youtube.upload",
          "https://www.googleapis.com/auth/youtube.readonly"]
PORT = 8765


def creds(interactive=False):
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    c = Credentials.from_authorized_user_file(str(TOKEN), SCOPES) if TOKEN.exists() else None
    if c and c.valid:
        return c
    if c and c.refresh_token:
        from google.auth.exceptions import RefreshError
        try:
            c.refresh(Request())
        except RefreshError:
            # app still in "Testing" => refresh tokens die after 7 days
            sys.exit("token expired or revoked: run `yt-upload auth` again")
    elif interactive:
        from google_auth_oauthlib.flow import InstalledAppFlow
        flow = InstalledAppFlow.from_client_secrets_file(str(SECRET), SCOPES)
        c = flow.run_local_server(port=PORT, open_browser=False, access_type="offline", prompt="consent",
                                  authorization_prompt_message="OPEN THIS URL: {url}",
                                  success_message="เชื่อมต่อ YouTube สำเร็จ ปิดหน้านี้ได้เลย")
    else:
        sys.exit("not authorised yet: run `yt-upload auth`")
    TOKEN.write_text(c.to_json()); TOKEN.chmod(0o600)
    return c


def service():
    from googleapiclient.discovery import build
    return build("youtube", "v3", credentials=creds(), cache_discovery=False)


def cmd_whoami(_):
    r = service().channels().list(part="snippet,statistics", mine=True).execute()
    for it in r.get("items", []):
        print(json.dumps({"id": it["id"], "title": it["snippet"]["title"],
                          "customUrl": it["snippet"].get("customUrl"),
                          "subscribers": it["statistics"].get("subscriberCount")}, ensure_ascii=False))
    if not r.get("items"):
        print("no channel on this account")


def cmd_upload(a):
    from googleapiclient.http import MediaFileUpload
    body = {"snippet": {"title": a.title[:100], "description": a.description,
                        "tags": [t for t in a.tags.split(",") if t], "categoryId": a.category,
                        "defaultLanguage": "th"},
            "status": {"privacyStatus": a.privacy, "selfDeclaredMadeForKids": False,
                       "containsSyntheticMedia": a.synthetic}}
    req = service().videos().insert(part="snippet,status", body=body,
                                    media_body=MediaFileUpload(a.video, chunksize=8 * 1024 * 1024, resumable=True))
    resp = None
    while resp is None:
        st, resp = req.next_chunk()
        if st:
            print(f"uploaded {int(st.progress() * 100)}%", file=sys.stderr)
    print(json.dumps({"id": resp["id"], "url": f"https://youtu.be/{resp['id']}",
                      "privacy": a.privacy}, ensure_ascii=False))


def main():
    p = argparse.ArgumentParser(prog="yt-upload")
    sp = p.add_subparsers(dest="cmd", required=True)
    sp.add_parser("auth").set_defaults(f=lambda a: (creds(True), print("ok: token saved")))
    sp.add_parser("whoami").set_defaults(f=cmd_whoami)
    u = sp.add_parser("upload"); u.set_defaults(f=cmd_upload)
    u.add_argument("video"); u.add_argument("--title", required=True)
    u.add_argument("--description", default=""); u.add_argument("--tags", default="")
    u.add_argument("--category", default="27", help="27 = Education")
    u.add_argument("--privacy", choices=["private", "unlisted", "public"], default="private")
    u.add_argument("--synthetic", action="store_true", help="declare AI-generated/altered realistic content")
    a = p.parse_args(); a.f(a)


if __name__ == "__main__":
    main()
