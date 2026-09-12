import assert from 'node:assert/strict';
import { evaluate, LayoutPass, Text, element_children } from '../src/index';
import { ErrorRuntime } from '../src/lib/errors';

const tests: Record<string, () => void> = {
  'indented JSX labels have the same content and size as inline labels'() {
    const pass = new LayoutPass();
    const inline = pass.layout(evaluate('<Text>Revenue</Text>'));
    for (const newline of ['\n', '\r\n', '\r']) {
      const code = ['<Text>', '', '    Revenue', '  ', '</Text>'].join(newline);
      const element = evaluate(code);
      assert.deepEqual(element.props.children, ['Revenue']);
      const fragment = pass.layout(element);
      assert.equal(fragment.label, 'Revenue');
      assert.deepEqual(fragment.size, inline.size);
      assert.equal(fragment.children.length, 1);
    }
  },

  'literal text keeps internal breaks and relative indentation in pre layout'() {
    const pass = new LayoutPass();
    for (const code of [
      '<Text whitespace="pre">\n    outer\n      inner\n\n    end\n</Text>',
      '<Text whitespace="pre">outer\n      inner\n\n    end</Text>',
      '<Text whitespace="pre">\n\t\touter\n\t\t  inner\n\n\t\tend\n</Text>',
    ]) {
      const element = evaluate(code);
      assert.deepEqual(element.props.children, ['outer\n  inner\n\nend']);
      const fragment = pass.layout(element);
      assert.equal(fragment.label, 'outer\n  inner\n\nend');
      assert.equal(fragment.children.length, 4);
    }
    const normal = pass.layout(evaluate('<Text>\n  first\n  second\n</Text>'));
    assert.equal(normal.label, 'first\nsecond');
    assert.equal(normal.children.length, 2);
  },

  'internal line breaks and common indentation survive inline span boundaries'() {
    const pass = new LayoutPass();
    const code = `<Text whitespace="pre">
      Hello
      <Span>world</Span>
        again
    </Text>`;
    const fragment = pass.layout(evaluate(code));
    assert.equal(fragment.label, 'Hello\nworld\n  again');
    assert.equal(fragment.children.length, 3);
    const commented = pass.layout(evaluate('<Text>\n  {/* note */}\n  Revenue\n  {/* note */}\n</Text>'));
    assert.equal(commented.label, 'Revenue');
  },

  'inline spacing survives spans, fragments, comments, and expressions'() {
    const pass = new LayoutPass();
    const expected = pass.layout(new Text({ text: 'Hello world again' }));
    for (const code of [
      '<Text>Hello <Span>world</Span> again</Text>',
      '<Text><Span>Hello</Span> <Span>world</Span> again</Text>',
      '<Text><Span>Hello </Span><Span>world </Span>again</Text>',
      '<Text>Hello{/* comment */} <><Span>world</Span></> again</Text>',
      '<Text>Hello {"world"} again</Text>',
      `<Text>
        Hello <Span>
          world
        </Span> again
      </Text>`,
      'const Word = ({ children }) => <Span>{children}</Span>; return <Text>Hello <Word>world</Word> again</Text>;',
    ]) {
      const fragment = pass.layout(evaluate(code));
      assert.equal(fragment.label, expected.label, code);
      assert.deepEqual(fragment.size, expected.size, code);
    }
    assert.equal(pass.layout(evaluate('<Text>extra<Span>ordinary</Span></Text>')).label, 'extraordinary');
  },

  'explicit strings and text attributes bypass JSX text normalization'() {
    const pass = new LayoutPass();
    const value = '\n  Revenue  \n';
    for (const code of [
      `<Text whitespace="pre">{${JSON.stringify(value)}}</Text>`,
      `<Text whitespace="pre" text={${JSON.stringify(value)}} />`,
      `<Text whitespace="pre" text="${value}" />`,
      '<Text whitespace="pre">{`\n  Revenue  \n`}</Text>',
    ]) {
      const element = evaluate(code);
      assert.ok(element instanceof Text);
      assert.equal(element.props.text ?? (element.props.children as string[])[0], value);
      assert.equal(pass.layout(element).label, value);
    }
    const blank = evaluate('<Text whitespace="pre">{["  ", "\\n"]}</Text>');
    assert.deepEqual(blank.props.children, ['  ', '\n']);
    assert.equal(pass.layout(blank).label, '  \n');
    assert.equal(pass.layout(evaluate('<Text>{"\\nRevenue\\n"}</Text>')).children.length, 3);
  },

  'formatting spaces do not become layout children in element containers'() {
    const pass = new LayoutPass();
    for (const code of [
      '<Svg> <HStack> <Rect width={px(10)} height={px(10)}/> <Rect width={px(10)} height={px(10)}/> </HStack> </Svg>',
      '<Svg>\n  <HStack>\n    <Rect width={px(10)} height={px(10)}/>\n    <Rect width={px(10)} height={px(10)}/>\n  </HStack>\n</Svg>',
    ]) {
      const root = evaluate(code);
      const [stack] = element_children(root.props.children);
      assert.equal(element_children(stack!.props.children).length, 2);
      assert.deepEqual(pass.layout(root).size, { width: 20, height: 10 });
    }
    const empty = evaluate('<Text>\n \t\n</Text>');
    assert.equal(empty.props.children, undefined);
    assert.deepEqual(pass.layout(empty).size, { width: 0, height: 0 });
    assert.throws(() => element_children('content'), /Expected an element child/);
    assert.throws(() => element_children('\u00a0'), /Expected an element child/);
  },

  'formatting spaces do not introduce empty text rows or bullet items'() {
    const pass = new LayoutPass();
    for (const tag of ['TextRow', 'TextCol', 'TextStack', 'Bullets']) {
      const spaced = evaluate(`<${tag}> <Text>One</Text> <Text>Two</Text> </${tag}>`);
      const compact = evaluate(`<${tag}><Text>One</Text><Text>Two</Text></${tag}>`);
      assert.equal(element_children(spaced.props.children).length, 2, tag);
      assert.deepEqual(pass.layout(spaced).size, pass.layout(compact).size, tag);
    }
  },

  'nonbreaking spaces and decoded JSX entities remain text content'() {
    const pass = new LayoutPass();
    for (const code of ['<Text>&nbsp;</Text>', '<Text>\n  &#160;\n</Text>']) {
      const element = evaluate(code);
      assert.deepEqual(element.props.children, ['\u00a0']);
      assert.equal(pass.layout(element).label, '\u00a0');
    }
    assert.equal(pass.layout(evaluate('<Text>\n  A &amp; B &lt; C\n</Text>')).label, 'A & B < C');
  },

  'normalizing JSX text preserves source lines in evaluation errors'() {
    const code = [
      'const label = <Text>',
      '    Revenue',
      '</Text>;',
      'return <Text>',
      '  Before <Span>inline</Span>',
      '  {fail()}',
      '</Text>;',
    ].join('\n');
    assert.throws(() => evaluate(code, { scope: { fail() { throw new Error('expected failure'); } } }), error => {
      assert.ok(error instanceof ErrorRuntime);
      assert.equal(error.message, 'expected failure');
      assert.equal(error.line, 6);
      return true;
    });
  },
};

for (const [name, test] of Object.entries(tests)) {
  test();
  console.log(`ok - ${name}`);
}
console.log(`${Object.keys(tests).length} JSX checks passed.`);
