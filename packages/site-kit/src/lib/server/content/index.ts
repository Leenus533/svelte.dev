import { extract_frontmatter, slugify } from '../../markdown/utils';
import type { Document } from '../../types';

export async function create_index(
	documents: Record<string, string>,
	assets: Record<string, string>,
	base: string,
	read: (asset: string) => Response
): Promise<Record<string, Document>> {
	const content: Record<string, Document> = {};

	const roots: Document[] = [];

	for (const key in documents) {
		if (key.includes('+assets') || key.endsWith('/_generated.md')) continue;

		const file = key.slice(base.length + 1);
		const slug = file.replace(/(^|\/)[\d-]+/g, '$1').replace(/(\/index)?\.md$/, '');

		const text = await read(documents[key]).text();
		let { metadata, body } = extract_frontmatter(text);

		if (!metadata.title) {
			throw new Error(`Missing title in ${slug} frontmatter`);
		}

		// Check if there's a generated file inside the same folder
		// which contains content to include in this document.
		const generated = documents[key.substring(0, key.lastIndexOf('/')) + '/_generated.md'];

		if (generated) {
			const generated_text = await read(generated).text();

			body = body.replaceAll(/<!-- @include (.+?) -->/g, (_, name) => {
				const include_start = `<!-- @include_start ${name} -->`;
				const snippet = generated_text.slice(
					generated_text.indexOf(include_start) + include_start.length,
					generated_text.indexOf(`<!-- @include_end ${name} -->`)
				);

				if (!snippet) {
					throw new Error(`Could not find include for ${name}`);
				}

				return snippet;
			});
		}

		const sections = Array.from(body.matchAll(/^##\s+(.*)$/gm)).map((match) => {
			const title = match[1];
			const slug = slugify(title);

			return { slug, title };
		});

		content[slug] = {
			slug,
			file,
			metadata: metadata as { title: string; [key: string]: any },
			body,
			sections,
			children: [],
			prev: null,
			next: null
		};
	}

	for (const slug in content) {
		const parts = slug.split('/');
		parts.pop();

		const document = content[slug];

		if (parts.length === 0) {
			roots.push(document);
		} else {
			const parent = content[parts.join('/')];

			if (parent) {
				parent.children.push(document);
			} else {
				roots.push(document);
			}
		}
	}

	for (const key in assets) {
		const path = key.slice(base.length + 1);
		const slug = path.slice(0, path.indexOf('+assets') - 1).replace(/(^|\/)\d+-/g, '$1');
		const file = path.slice(path.indexOf('+assets') + 8);

		const document = content[slug];

		(document.assets ??= {})[file] = assets[key];
	}

	let prev: Document | null = null;

	for (const document of roots) {
		prev = create_links(document, prev);
	}

	return content;
}

function create_links(document: Document, prev: Document | null): Document | null {
	if (document.children.length === 0 && !document.body) {
		throw new Error(`Document ${document.slug} has no body and no children`);
	}

	if (document.body) {
		link(prev, document);
		prev = document;
	}

	for (let i = 0; i < document.children.length; i += 1) {
		prev = create_links(document.children[i], prev);
	}

	return prev;
}

function link(prev: Document | null, next: Document | null) {
	if (prev) prev.next = next && { slug: next.slug, title: next.metadata.title };
	if (next) next.prev = prev && { slug: prev.slug, title: prev.metadata.title };
}
