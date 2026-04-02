SHELL := /bin/zsh

.PHONY: setup demo ticket typecheck build

setup:
	mise exec -- pnpm install

demo:
	mise exec -- pnpm run demo

ticket:
	mise exec -- pnpm run ticket

typecheck:
	mise exec -- pnpm run typecheck

build:
	mise exec -- pnpm run build
