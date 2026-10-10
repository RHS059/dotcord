#!/usr/bin/env bash
set -euo pipefail

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
dist_root="$project_root/dist"

rm -rf "$dist_root"
mkdir -p "$dist_root/server" "$dist_root/.openai"
cd "$project_root"
node node_modules/typescript/bin/tsc
node node_modules/vite/bin/vite.js build
node scripts/embed-client.mjs
hosting_manifest="$project_root/.openai/hosting.json"
if [[ ! -f "$hosting_manifest" ]]; then
  hosting_manifest="$project_root/.openai/hosting.example.json"
fi
cp "$hosting_manifest" "$dist_root/.openai/hosting.json"

echo "Built $dist_root"
cp -r "$project_root/drizzle" "$dist_root/drizzle"
node --input-type=module - "$dist_root/server/wrangler.json" <<'JS'
import fs from 'node:fs';fs.writeFileSync(process.argv[2],JSON.stringify({name:'dot-mention-relay',main:'index.js',compatibility_date:'2026-05-15',compatibility_flags:['nodejs_compat'],no_bundle:true,d1_databases:[{binding:'DB',database_name:'dot-relay-d1',database_id:'00000000-0000-4000-8000-000000000000'}]},null,2));
JS
