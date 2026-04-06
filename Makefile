SHELL := /bin/zsh

.PHONY: setup setup-braintrust demo ticket seed-dataset eval replay-failure typecheck build deck

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

deck:
	@echo "Building workshop deck..."
	@mkdir -p docs/slides
	@VERSION=$$(node -p "require('./package.json').version"); \
	sed "s/{{VERSION}}/$${VERSION}/g" docs/slides/workshop-deck.md > docs/slides/.workshop-deck-build.md
	@npx @marp-team/marp-cli docs/slides/.workshop-deck-build.md \
		--html --no-stdin \
		-o docs/index.html
	@rm docs/slides/.workshop-deck-build.md
	@node -e 'const fs=require("fs"); const p="docs/index.html"; let html=fs.readFileSync(p,"utf8"); html=html.replaceAll("src=\"assets/","src=\"slides/assets/").replaceAll("src='\''assets/","src='\''slides/assets/").replaceAll("url('\''assets/","url('\''slides/assets/").replaceAll("url(\"assets/","url(\"slides/assets/").replaceAll("href=\"assets/","href=\"slides/assets/").replaceAll("href='\''assets/","href='\''slides/assets/"); fs.writeFileSync(p,html);'
	@echo "Deck built: docs/index.html"
