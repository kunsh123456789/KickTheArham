#!/usr/bin/env python3
"""Bundle index.html + style.css + game.js into one self-contained file.

    python3 build.py                 -> KickTheArham.html (open it in any browser, works offline)
    python3 build.py --fragment OUT  -> page body only (for hosts that supply their own <html>/<head>)
"""
import pathlib
import sys

root = pathlib.Path(__file__).parent
html = (root / 'index.html').read_text(encoding='utf-8')
css = (root / 'style.css').read_text(encoding='utf-8')
js = (root / 'game.js').read_text(encoding='utf-8')

body = html.split('<body>', 1)[1].split('</body>', 1)[0]
body = body.replace('<script src="game.js"></script>', '<script>\n' + js + '\n</script>')

if len(sys.argv) > 2 and sys.argv[1] == '--fragment':
    out = pathlib.Path(sys.argv[2])
    out.write_text(f'<title>Kick The Arham</title>\n<style>\n{css}\n</style>\n{body}', encoding='utf-8')
else:
    head = html.split('<head>', 1)[1].split('</head>', 1)[0]
    head = head.replace('<link rel="stylesheet" href="style.css">', '<style>\n' + css + '\n</style>')
    out = root / 'KickTheArham.html'
    out.write_text(f'<!DOCTYPE html>\n<html lang="en">\n<head>{head}</head>\n<body>{body}</body>\n</html>\n', encoding='utf-8')
print(f'wrote {out} ({out.stat().st_size // 1024} KB)')
