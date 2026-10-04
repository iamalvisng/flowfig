const MAX_WORDS = 15;
const CODE = /^(import|export|const|let|var|return|if|for|while|function|await)\b|[;{}]\s*$|^\w+(\.\w+)*\(.*\)\s*;?$/;
const DIRECTIVE = /^\s*(eslint|oxlint|biome|@ts-|prettier-ignore|#region|#endregion)/;

function commentGroups(src) {
  const groups = [];
  for (const c of src.getAllComments()) {
    if (c.value.startsWith('!') || DIRECTIVE.test(c.value) || c.value.startsWith('/')) continue;
    const last = groups.at(-1)?.at(-1);
    const joined =
      last &&
      last.type === 'Line' &&
      c.type === 'Line' &&
      c.loc.start.line === last.loc.end.line + 1 &&
      c.loc.start.column === last.loc.start.column;
    if (joined) groups.at(-1).push(c);
    else groups.push([c]);
  }
  return groups.map((cs) => {
    const first = cs[0];
    const doc = first.type === 'Block' && first.value.startsWith('*');
    const text = cs
      .map((c) => c.value.replace(/^\*|\n\s*\*/g, ' '))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    const lines = cs.flatMap((c) => c.value.split('\n')).filter((l) => l.replace(/^[\s*]+/, '').length).length;
    return {
      cs,
      doc,
      text,
      lines,
      words: text ? text.split(' ').length : 0,
      loc: { start: first.loc.start, end: cs.at(-1).loc.end },
    };
  });
}

function exportKind(node) {
  for (let n = node; n; n = n.parent) {
    if (n.type === 'ExportNamedDeclaration' || n.type === 'ExportDefaultDeclaration') {
      const t = n.declaration?.type ?? '';
      if (/TSInterfaceDeclaration|TSTypeAliasDeclaration/.test(t)) return 'type';
      if (t === 'FunctionDeclaration') return 'function';
      return null;
    }
    if (/Function|Class|Program|BlockStatement/.test(n.type)) return null;
  }
  return null;
}

const comments = {
  meta: { type: 'suggestion', schema: [] },
  create(context) {
    const src = context.sourceCode;
    return {
      Program() {
        for (const g of commentGroups(src)) {
          const report = (message) => context.report({ loc: g.loc, message });
          if (/\b(TODO|FIXME|XXX|HACK)\b/.test(g.text)) report('No TODO or FIXME.');
          if (!g.doc && g.cs.some((c) => CODE.test(c.value.trim()))) {
            report('No commented-out code.');
          }
          let maxLines = 1;
          let maxWords = MAX_WORDS;
          if (g.doc) {
            const next = src.getTokenAfter(g.cs.at(-1), { includeComments: false });
            const kind = next && exportKind(src.getNodeByRangeIndex(next.range[0]));
            if (!kind) {
              report('A doc comment goes on an exported type, interface or function only.');
              continue;
            }
            if (kind === 'function') {
              maxLines = 2;
              maxWords = 2 * MAX_WORDS;
            }
          }
          if (g.lines > maxLines) report(`A comment has ${maxLines} line or fewer.`);
          if (g.words > maxWords) report(`A comment has ${maxWords} words or fewer.`);
        }
      },
    };
  },
};

const testAsserts = {
  meta: {
    type: 'problem',
    schema: [{ type: 'object', properties: { assertNames: { type: 'array' } } }],
  },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== 'Identifier' || !/^(test|it)$/.test(node.callee.name)) return;
        const fn = node.arguments.at(-1);
        if (!fn || !/Function/.test(fn.type)) return;
        const names = context.options[0]?.assertNames ?? ['assert'];
        const re = new RegExp(`\\b(${names.join('|')})\\b`);
        if (!re.test(context.sourceCode.getText(fn))) {
          context.report({ node, message: 'A test asserts something.' });
        }
      },
    };
  },
};

const svgSnapshot = {
  meta: { type: 'problem', schema: [] },
  create(context) {
    const check = (node, text) => {
      if (/^\s*<svg[\s>]/.test(text) && text.length > 200) {
        context.report({ node, message: 'No snapshot of a whole SVG. Assert the one fact.' });
      }
    };
    return {
      'CallExpression[callee.property.name="snapshot"]'(node) {
        context.report({ node, message: 'No snapshot test.' });
      },
      Literal(node) {
        if (typeof node.value === 'string') check(node, node.value);
      },
      TemplateLiteral(node) {
        check(node, node.quasis.map((q) => q.value.raw).join(''));
      },
    };
  },
};

export default {
  meta: { name: 'flowfig' },
  rules: { comments, 'test-asserts': testAsserts, 'svg-snapshot': svgSnapshot },
};
