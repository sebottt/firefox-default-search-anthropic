#!/usr/bin/env bash
# Fails if anything that identifies the analysed host would be committed.
# Run from the repository root before `git add`.
#
# Falla si algo que identifique al equipo analizado fuera a subirse al repositorio.
# Ejecutar desde la raíz del repositorio antes de `git add`.
#
# Add your own values to EXTRA below. Do not paste a secret literally into this
# file: it would become the leak it is meant to prevent. Put them in a file
# outside the repository and point CHECK_NO_PII_EXTRA at it.
#
# Añade tus propios valores en EXTRA. No pegues un secreto literal en este
# archivo: se convertiría en la fuga que pretende evitar. Ponlos en un archivo
# fuera del repositorio y apunta CHECK_NO_PII_EXTRA a él.

set -uo pipefail

PATTERNS=(
  '18\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}'
  '192\.168\.[0-9]{1,3}\.[0-9]{1,3}'
  '10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}'
  '172\.(1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3}'
  '[A-Za-z0-9._%+-]+@(gmail|outlook|hotmail|yahoo|proton)\.'
  '/home/[a-z][a-z0-9_-]*/'
  '/Users/[a-z][a-z0-9_-]*/'
  '[0-9a-f]{8}\.default'
  'BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY'
)

# Optional extra patterns, one per line, from a file outside the repo.
if [ -n "${CHECK_NO_PII_EXTRA:-}" ] && [ -r "${CHECK_NO_PII_EXTRA}" ]; then
  while IFS= read -r line; do
    [ -n "$line" ] && PATTERNS+=("$line")
  done < "${CHECK_NO_PII_EXTRA}"
fi

self="$(basename "$0")"
fail=0

for p in "${PATTERNS[@]}"; do
  # Options must precede the pattern: a `--` here would stop grep from parsing
  # the --exclude flags and they would be read as file arguments instead.
  hits=$(grep -rInE \
           --exclude-dir=.git \
           --exclude-dir=samples \
           --exclude="$self" \
           -e "$p" . 2>/dev/null)
  if [ -n "$hits" ]; then
    echo "LEAK: pattern /$p/"
    echo "$hits" | sed 's/^/  /'
    fail=1
  fi
done

if [ "$fail" -eq 0 ]; then
  echo "clean: no host-identifying data found"
  exit 0
fi

echo
echo "Refusing to vouch for this tree. Remove the matches above before committing."
exit 1
