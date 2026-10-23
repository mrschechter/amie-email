/**
 * @jest-environment jsdom
 */
import grapesjs, { Component, Editor } from "grapesjs";

import { MAUTIC_EMAIL } from "./__fixtures__/mauticEmail";
import {
  configureHtmlModeComponents,
  installImageSettings,
  installTextCells,
} from "./visualEmailComponents";
import {
  exportHtmlDocument,
  HTML_BLOCKS,
  importHtmlIntoEditor,
  splitHtmlDocument,
} from "./visualEmailHtml";
import { htmlComponentName } from "./visualEmailNames";

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((e) => e.destroy()));

function load(body: string, friendly = true) {
  const editor = grapesjs.init({
    headless: true,
    storageManager: false,
    protectedCss: "",
  });
  editors.push(editor);
  if (friendly) {
    configureHtmlModeComponents(editor);
  } else {
    // exactly what #57 installed, without friendly names
    installTextCells(editor);
    installImageSettings(editor, "html");
  }
  const split = splitHtmlDocument(body);
  importHtmlIntoEditor(editor, split);
  return {
    editor,
    save: () => exportHtmlDocument(editor, split.shell),
  };
}

function all(root: Component | undefined): Component[] {
  if (!root) return [];
  return [root, ...root.components().models.flatMap((c) => all(c))];
}

/** Layer tree as "Name" lines, indented by depth (text nodes skipped). */
function layerTree(root: Component | undefined, depth = 0): string[] {
  // the Layer Manager doesn't list text nodes or line breaks either
  if (
    !root ||
    root.get("type") === "textnode" ||
    root.get("tagName") === "br"
  ) {
    return [];
  }
  return [
    `${"  ".repeat(depth)}${root.getName()}`,
    ...root.components().models.flatMap((c) => layerTree(c, depth + 1)),
  ];
}

describe("HTML-mode blocks", () => {
  it("every block has an inline SVG icon (no icon font or external file)", () => {
    expect(HTML_BLOCKS).toHaveLength(10);
    for (const block of HTML_BLOCKS) {
      expect(block.media).toMatch(
        /^<svg viewBox="0 0 24 24"><path fill="currentColor" d="M[^"]+"\/><\/svg>$/,
      );
      expect(block.media).not.toMatch(/https?:|class=|fa-/);
    }
    expect(new Set(HTML_BLOCKS.map((b) => b.media)).size).toBe(
      HTML_BLOCKS.length,
    );
  });

  it("block icons reach the GrapesJS block manager", () => {
    const { editor } = load("<p>x</p>");
    HTML_BLOCKS.forEach(({ id, ...block }) =>
      editor.BlockManager.add(id, block),
    );
    for (const block of HTML_BLOCKS) {
      expect(editor.BlockManager.get(block.id).getMedia()).toBe(block.media);
    }
  });
});

describe("friendly layer names in HTML mode", () => {
  it("names the Mautic fixture with MJML vocabulary", () => {
    const { editor } = load(MAUTIC_EMAIL);
    expect(layerTree(editor.getWrapper())).toEqual([
      "Body",
      "  Section",
      "    Rows",
      "      Section",
      "        Column",
      "          Section",
      "            Rows",
      "              Section",
      "                Column",
      "                  Link",
      "                    Image",
      "              Section",
      "                Column",
      "                  Text",
      "                  Text",
      "                  Image",
      "              Section",
      "                Text",
      "                  Button",
      "              Section",
      "                Text",
      "                  Link",
      "                  Link",
    ]);
  });

  it("recognises columns, buttons, dividers and spacers from the blocks", () => {
    const { editor } = load(HTML_BLOCKS.map((b) => b.content).join(""));
    const names = editor
      .getWrapper()
      ?.components()
      .models.map((c) => c.getName());
    expect(names).toEqual([
      "Section", // Section block
      "Section", // 2 Columns block (a section of columns)
      "Text", // Heading
      "Text", // Text
      "Image",
      "Button", // bulletproof button table
      "Link",
      "Divider",
      "Spacer",
      "Text", // unsubscribe footer
    ]);
    const twoCols = editor.getWrapper()?.components().at(1);
    const row = all(twoCols).find((c) => c.get("tagName") === "tr");
    expect(row?.getName()).toBe("Columns");
    expect(
      all(row)
        .filter((c) => c.get("tagName") === "td")
        .map((c) => c.getName()),
    ).toEqual(["Column", "Column"]);
  });

  it("names hr, empty bordered cells and spacer rows", () => {
    const { editor } = load(
      '<hr><table><tr><td style="height:20px;line-height:20px;font-size:0;">&nbsp;</td></tr></table><table><tr><td style="border-top:1px solid #ccc;"></td></tr></table><a href="x" class="btn">Go</a>',
    );
    expect(
      editor
        .getWrapper()
        ?.components()
        .map((c) => c.getName()),
    ).toEqual(["Divider", "Spacer", "Divider", "Button"]);
  });

  it("text-only cells with a line-height are Text, not Spacer", () => {
    const { editor } = load(
      '<table><tr><td style="padding:8px;line-height:24px;">Hey there</td></tr><tr><td style="height:20px;line-height:20px;">&nbsp;</td></tr></table>',
    );
    const cells = all(editor.getWrapper()).filter(
      (c) => c.get("tagName") === "td",
    );
    expect(cells.map((c) => c.getName())).toEqual(["Text", "Spacer"]);
  });

  it("a name the user gives a layer still wins", () => {
    const { editor } = load(MAUTIC_EMAIL);
    const card = all(editor.getWrapper()).find((c) =>
      c.getClasses().includes("container"),
    );
    card?.set("custom-name", "Main card");
    expect(card?.getName()).toBe("Main card");
    expect(card && htmlComponentName(card)).toBe("Section");
  });

  it("is display-only: saved HTML and project data are byte-identical", () => {
    const plain = load(MAUTIC_EMAIL, false);
    const friendly = load(MAUTIC_EMAIL, true);
    expect(friendly.save()).toBe(plain.save());
    // GrapesJS ids are random per editor; everything else must match
    const normalized = (editor: Editor) =>
      JSON.stringify(editor.getProjectData())
        .replace(/"#?i[a-z0-9]{3,6}(-\d+)?"/g, '"ID"')
        .replace(/"id":"[A-Za-z0-9]{16}"/g, '"id":"PAGE"');
    expect(normalized(friendly.editor)).toBe(normalized(plain.editor));
    expect(friendly.save()).not.toMatch(/custom-name|data-gjs|Section|Column/);
    // and naming every layer doesn't make the editor dirty (no write on open)
    friendly.editor.clearDirtyCount();
    layerTree(friendly.editor.getWrapper());
    expect(friendly.editor.getDirtyCount()).toBe(0);
  });
});
