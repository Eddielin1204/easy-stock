#!/usr/bin/env bash
set -euo pipefail

asset_dir=${1:-}
target_uri=${2:-oss://easy-stock-fs/updates/desktop}
public_url=${3:-https://easy-stock-fs.oss-cn-beijing.aliyuncs.com/updates/desktop}

if [[ ! -d "$asset_dir" ]]; then
  echo "Usage: publish-updater-oss.sh <asset-dir> [target-uri] [public-url]" >&2
  exit 2
fi
if command -v ossutil >/dev/null 2>&1; then
  ossutil_command=$(command -v ossutil)
elif [[ -n "${OSSUTIL_BIN:-}" && -x "$OSSUTIL_BIN" ]]; then
  ossutil_command=$OSSUTIL_BIN
else
  echo "ossutil is required" >&2
  exit 2
fi
ossutil_options=()
[[ -n "${OSS_ACCESS_KEY_ID:-}" ]] && ossutil_options+=(--access-key-id "$OSS_ACCESS_KEY_ID")
[[ -n "${OSS_ACCESS_KEY_SECRET:-}" ]] && ossutil_options+=(--access-key-secret "$OSS_ACCESS_KEY_SECRET")
[[ -n "${OSS_ENDPOINT:-}" ]] && ossutil_options+=(--endpoint "$OSS_ENDPOINT")
[[ -n "${OSS_REGION:-}" ]] && ossutil_options+=(--region "$OSS_REGION")
ossutil_options+=(--connect-timeout 20 --read-timeout 60 --retry-times 3)
verification_root=$(mktemp -d)
trap 'rm -rf "$verification_root"' EXIT
upload_timeout=()
if command -v timeout >/dev/null 2>&1; then
  upload_timeout=(timeout --kill-after=15s "${OSS_UPLOAD_TIMEOUT_SECONDS:-600}s")
fi

upload() {
  local file=$1 cache_control=$2 name attempt
  name=$(basename "$file")
  for attempt in 1 2 3; do
    echo "Uploading $name (attempt $attempt/3)"
    if "${upload_timeout[@]}" "$ossutil_command" "${ossutil_options[@]}" cp "$file" "${target_uri%/}/$name" \
      --force --no-progress --parallel 2 --part-size 4Mi --checkpoint-dir "$verification_root/checkpoints" --cache-control "$cache_control"; then
      return 0
    fi
  done
  echo "Failed to upload $name after 3 attempts" >&2
  return 1
}

verify_public_size() {
  local file=$1 name headers local_size remote_size
  name=$(basename "$file")
  headers="$verification_root/headers"
  curl --fail --silent --show-error --location --head --connect-timeout 20 --max-time 60 --retry 3 \
    "${public_url%/}/$name" --dump-header "$headers" --output /dev/null
  local_size=$(wc -c < "$file" | tr -d ' ')
  remote_size=$(awk 'tolower($1) == "content-length:" { gsub("\r", "", $2); size=$2 } END { print size }' "$headers")
  [[ "$remote_size" == "$local_size" ]] || { echo "Public OSS size mismatch: $name ($remote_size != $local_size)" >&2; return 1; }
}

# Check metadata before uploading anything or changing either update channel.
node "$(dirname "${BASH_SOURCE[0]}")/verify-updater-artifacts.mjs" "$asset_dir" latest-mac.yml latest.yml

versioned=()
while IFS= read -r file; do
  name=$(basename "$file")
  case "$name" in
    latest-mac.yml|latest.yml) ;;
    *) versioned+=("$file") ;;
  esac
done < <(find "$asset_dir" -maxdepth 1 -type f -print | sort)

for file in "${versioned[@]}"; do
  upload "$file" "public,max-age=31536000,immutable"
  verify_public_size "$file"
done

# Publish mutable manifests last so clients cannot observe an incomplete version.
for name in latest-mac.yml latest.yml; do
  file="$asset_dir/$name"
  [[ -f "$file" ]] || { echo "Missing updater metadata: $name" >&2; exit 1; }
  upload "$file" "no-cache, no-store, must-revalidate"
  curl --fail --silent --show-error --location --connect-timeout 20 --max-time 60 --retry 3 \
    "${public_url%/}/$name" --output "$verification_root/$name"
  cmp "$file" "$verification_root/$name" || { echo "Public OSS metadata mismatch: $name" >&2; exit 1; }
done

echo "Published and verified updater assets at ${public_url%/}"
