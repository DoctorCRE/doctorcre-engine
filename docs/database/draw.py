import json
import re
import subprocess
import sys
from pathlib import Path

container = sys.argv[1]
config = Path('docs/database/.tbls.yml').read_text()
views = {}
for block in re.split(r'(?=^  - id: )', config, flags=re.M)[1:]:
    name = block.splitlines()[0].split(': ', 1)[1]
    members = set(re.findall(r'^      - (next\.\w+)', block, re.M))
    core = set(re.findall(r'^      - (next\.\w+) # area$', block, re.M))
    views[name] = (members, core)

base = ['docker', 'run', '--rm', '--network', f'container:{container}', '-v', f'{Path.cwd()}:/work', '-w', '/work', 'ghcr.io/k1low/tbls:v1.97.0', 'out', 'postgres://postgres@localhost:5432/postgres?sslmode=disable&search_path=next']
schema = json.loads(subprocess.check_output(base + ['-t', 'json']))
tables = {t['name'] for t in schema['tables'] if t['type'] == 'BASE TABLE'}
assigned = [table for _, core in views.values() for table in core]
if set(assigned) != tables or len(assigned) != len(tables):
    raise SystemExit(f'Assign every table once. Missing: {sorted(tables - set(assigned))}; extra or duplicate: {sorted(set(assigned) - tables)}')
for name, (members, core) in views.items():
    missing = {r['parent_table'] for r in schema['relations'] if r['table'] in core and r['parent_table'] in tables and r['parent_table'] not in members}
    if missing:
        raise SystemExit(f'{name} needs referenced tables: {sorted(missing)}')
    diagram = subprocess.check_output(base + ['-c', 'docs/database/.tbls.yml', '-t', 'mermaid', '--viewpoint', name, '--sort'], text=True)
    edges = [line for line in diagram.splitlines() if re.match(r'^"[^"]+" .* : ', line)]
    lines = [f'# {name}', '']
    for table in sorted(core):
        table_edges = [edge for edge in edges if edge.startswith(f'"{table}" ')]
        expected = sum(r['table'] == table for r in schema['relations'])
        if len(table_edges) != expected:
            raise SystemExit(f'{table} has {expected} foreign keys but its drawing has {len(table_edges)}')
        lines += [f'## {table}', '', '```mermaid', 'erDiagram']
        lines += [edge.rsplit(' : ', 1)[0] + ' : ""' for edge in table_edges] or [f'"{table}"']
        lines += ['```', '']
        definitions = [edge.rsplit(chr(34), 2)[1].replace('#quot;', chr(34)) for edge in table_edges]
        lines += [f'- `{definition}`' for definition in definitions]
        lines += [''] if table_edges else []
    Path(f'docs/database/{name}.md').write_text('\n'.join(lines))
