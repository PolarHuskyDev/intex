#!/bin/bash

REPO_ROOT=$(git rev-parse --show-toplevel)

# Compile PDF viewer
cd "$REPO_ROOT/src/latex/pdf/viewer"
wasm-pack build --release --target web
exitCode=$?

if [ $exitCode -ne 0 ]; then
	echo "Failed to compile PDF viewer"
	exit $exitCode
fi
