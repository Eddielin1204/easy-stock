#!/usr/bin/env bash
set -euo pipefail

release_tag=${1:-}
asset_dir=${2:-}
notes_file=${3:-}
if [[ -z "$release_tag" || ! -d "$asset_dir" || ! -f "$notes_file" ]]; then
  echo "Usage: publish-github-release.sh <release-tag> <asset-dir> <notes-file>" >&2
  exit 2
fi

if ! gh release view "$release_tag" >/dev/null 2>&1; then
  gh release create "$release_tag" --draft --verify-tag --title "easy-stock $release_tag" --notes-file "$notes_file"
fi

gh release upload "$release_tag" "$asset_dir"/* --clobber
desired_assets=$(mktemp)
trap 'rm -f "$desired_assets"' EXIT
find "$asset_dir" -maxdepth 1 -type f -exec basename {} \; | sort > "$desired_assets"
while IFS= read -r asset; do
  if [[ -n "$asset" ]] && ! grep -Fqx "$asset" "$desired_assets"; then
    gh release delete-asset "$release_tag" "$asset" --yes
  fi
done < <(gh release view "$release_tag" --json assets --jq '.assets[].name')

# Keep new releases private until all uploaded bytes match the verified build.
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
gh release view "$release_tag" --json assets | node "$script_dir/verify-github-release-assets.mjs" "$asset_dir"
gh release edit "$release_tag" --draft=false --latest --title "easy-stock $release_tag" --notes-file "$notes_file"
echo "Published verified GitHub Release $release_tag"
