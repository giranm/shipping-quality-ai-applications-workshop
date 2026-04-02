SHELL := /bin/zsh

.PHONY: setup setup-braintrust demo ticket seed-dataset eval replay-failure typecheck build

setup:
	mise exec -- pnpm install

setup-braintrust:
	mise exec -- pnpm run setup:braintrust

demo:
	mise exec -- pnpm run demo

ticket:
	mise exec -- pnpm run ticket

seed-dataset:
	mise exec -- pnpm run seed:dataset

eval:
	mise exec -- pnpm run eval

replay-failure:
	mise exec -- pnpm run replay:failure

typecheck:
	mise exec -- pnpm run typecheck

build:
	mise exec -- pnpm run build
