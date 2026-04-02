SHELL := /bin/zsh

.PHONY: setup demo ticket seed-dataset eval typecheck build

setup:
	mise exec -- pnpm install

demo:
	mise exec -- pnpm run demo

ticket:
	mise exec -- pnpm run ticket

seed-dataset:
	mise exec -- pnpm run seed:dataset

eval:
	mise exec -- pnpm run eval

typecheck:
	mise exec -- pnpm run typecheck

build:
	mise exec -- pnpm run build
