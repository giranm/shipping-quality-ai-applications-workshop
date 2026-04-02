SHELL := /bin/zsh

.PHONY: setup typecheck build

setup:
	mise exec -- pnpm install

typecheck:
	mise exec -- pnpm run typecheck

build:
	mise exec -- pnpm run build
