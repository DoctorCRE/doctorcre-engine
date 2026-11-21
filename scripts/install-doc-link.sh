#!/bin/bash
if [[ "$(uname -s)" != Darwin ]]; then
	printf '%s\n' 'Doc link setup requires macOS.' >&2
	exit 1
fi

if [[ "$(node --version 2>/dev/null)" != v26.* ]]; then
	printf '%s\n' 'Install Node.js 26 from nodejs.org, open a new Terminal window, and run setup again.' >&2
	exit 1
fi

if [[ $# != 1 ]]; then
	printf '%s\n' 'Run bash scripts/install-doc-link.sh with the HTTPS engine origin.' >&2
	exit 1
fi

script_dir=$(cd -- "$(dirname -- "$0")" && pwd) || exit 1
if [[ ! -f "$script_dir/../node_modules/zod/package.json" ]]; then
	printf '%s\n' 'Run npm ci in the DoctorCRE Engine checkout, then run setup again.' >&2
	exit 1
fi

exec node "$script_dir/install-doc-link.ts" "$1"
