#!/bin/bash
set -e

# Replace the placeholder with the actual API key in all JS files
if [ -n "$GEMINI_API_KEY" ]; then
    find /usr/share/caddy/html -name '*.js' -exec sed -i "s/__GEMINI_API_KEY_PLACEHOLDER__/$GEMINI_API_KEY/g" {} +
    echo "Injected GEMINI_API_KEY into application"
else
    echo "Warning: GEMINI_API_KEY environment variable not set"
fi

# Execute the CMD
exec "$@"
