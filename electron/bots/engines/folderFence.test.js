/**
 * folderFence.test.js — a bot's folders as a boundary (DASH-47).
 */
"use strict";

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { tempDir } = require("../../testUtils/tempDir");
const {
  makeFence,
  fileToolOutside,
  bashOutside,
  bashSends,
} = require("./folderFence");

let repo; // a bot's folder
let other; // a folder it wasn't given
let sandbox; // the run's working folder
let fence;

before(() => {
  repo = tempDir("fence-repo-");
  other = tempDir("fence-other-");
  sandbox = tempDir("fence-sandbox-");
  fs.mkdirSync(path.join(repo, "src"));
  fs.writeFileSync(path.join(repo, "src", "a.js"), "x");
  fs.writeFileSync(path.join(other, "secret.txt"), "x");
  // A link inside the repo that points out of it.
  fs.symlinkSync(other, path.join(repo, "escape"));
  fence = makeFence({ projects: [repo], workingDir: sandbox });
});

describe("makeFence", () => {
  it("is null for a bot without folders", () => {
    assert.equal(makeFence({ projects: [] }), null);
    assert.equal(makeFence({}), null);
    assert.equal(makeFence({ projects: ["relative/dir"] }), null);
  });

  it("holds its folders and the run's working folder", () => {
    assert.deepEqual(fence.projects, [repo]);
    assert.equal(fence.roots.length, 2);
    assert.equal(fence.cwd, sandbox);
  });
});

describe("fileToolOutside", () => {
  it("lets a file tool use paths inside its folders", () => {
    assert.equal(
      fileToolOutside(fence, "Read", {
        file_path: path.join(repo, "src", "a.js"),
      }),
      null,
    );
    // A file about to be written doesn't exist yet.
    assert.equal(
      fileToolOutside(fence, "Write", {
        file_path: path.join(repo, "src", "new", "b.js"),
      }),
      null,
    );
    assert.equal(
      fileToolOutside(fence, "Edit", { file_path: path.join(sandbox, "x") }),
      null,
    );
    assert.equal(fileToolOutside(fence, "Grep", { path: repo }), null);
  });

  it("refuses paths outside, through .. and through symlinks", () => {
    const secret = path.join(other, "secret.txt");
    assert.equal(fileToolOutside(fence, "Read", { file_path: secret }), secret);
    const up = path.join(repo, "..", path.basename(other), "secret.txt");
    assert.equal(fileToolOutside(fence, "Read", { file_path: up }), up);
    const linked = path.join(repo, "escape", "secret.txt");
    assert.equal(
      fileToolOutside(fence, "Write", { file_path: linked }),
      linked,
    );
    assert.equal(
      fileToolOutside(fence, "Read", { file_path: "~/.ssh/config" }),
      "~/.ssh/config",
    );
    assert.equal(
      fileToolOutside(fence, "NotebookEdit", { notebook_path: "/tmp/x.ipynb" }),
      "/tmp/x.ipynb",
    );
  });

  it("takes relative paths and a missing search path from the working folder", () => {
    assert.equal(
      fileToolOutside(fence, "Read", { file_path: "notes.md" }),
      null,
    );
    assert.equal(fileToolOutside(fence, "Glob", { pattern: "**/*.js" }), null);
    assert.equal(
      fileToolOutside(fence, "Read", { file_path: "../../../etc/hosts" }),
      "../../../etc/hosts",
    );
  });

  it("checks the folder an absolute Glob pattern names", () => {
    assert.equal(
      fileToolOutside(fence, "Glob", { pattern: `${repo}/src/**/*.js` }),
      null,
    );
    assert.ok(fileToolOutside(fence, "Glob", { pattern: "/etc/**/*.conf" }));
  });

  it("does nothing without a fence or for other tools", () => {
    assert.equal(
      fileToolOutside(null, "Read", { file_path: "/etc/hosts" }),
      null,
    );
    assert.equal(fileToolOutside(fence, "Bash", { command: "ls /" }), null);
  });
});

describe("bashOutside", () => {
  it("lets commands that stay in its folders run", () => {
    for (const c of [
      `cd ${repo} && git status && npm run ci`,
      `cd ${repo}/src && ls`,
      `cd ${repo} && cd src && cat a.js`,
      "git log --oneline -3",
      "npm test 2>/dev/null",
      "git log HEAD~3",
      "curl https://example.com/a/b",
      `cd "${repo}" && ./scripts/ci.sh --pr -m "fix(DASH-47): x"`,
    ]) {
      assert.equal(bashOutside(fence, c), null, c);
    }
  });

  it("finds a cd or an absolute path outside", () => {
    assert.equal(bashOutside(fence, `cd ${other} && ls`), other);
    assert.equal(bashOutside(fence, `cd ${repo} && cd .. && ls`), "..");
    assert.equal(bashOutside(fence, "cd && ls"), "~");
    assert.equal(bashOutside(fence, "cd $SOMEWHERE"), "$SOMEWHERE");
    assert.equal(bashOutside(fence, "cat ~/.ssh/config"), "~/.ssh/config");
    assert.equal(bashOutside(fence, "cat $HOME/.zshrc"), "$HOME/.zshrc");
    assert.equal(bashOutside(fence, "sed -i s/a/b/ /etc/hosts"), "/etc/hosts");
    assert.equal(bashOutside(fence, "echo x > /tmp/out.txt"), "/tmp/out.txt");
    assert.equal(bashOutside(fence, "node --out=/tmp/x run.js"), "/tmp/x");
    assert.equal(
      bashOutside(fence, `cat ${repo}/escape/secret.txt`),
      `${repo}/escape/secret.txt`,
    );
  });

  it("does nothing without a fence", () => {
    assert.equal(bashOutside(null, "cat /etc/hosts"), null);
  });

  it("knows the home folder is outside", () => {
    assert.ok(!os.homedir().startsWith(repo));
  });
});

describe("bashSends", () => {
  it("spots commands that send something off the computer", () => {
    for (const c of [
      "curl -X POST https://x",
      "cd /r && wget https://x",
      "git push origin feature",
      "git -C /r push",
      "gh pr create --fill",
      "gh api repos/x",
      "FOO=1 ssh host",
      "rsync -a . host:/x",
    ]) {
      assert.equal(bashSends(c), true, c);
    }
  });

  it("lets local work and gh lookups through", () => {
    for (const c of [
      "git status && git diff",
      "npm run ci",
      "gh pr view 12",
      "gh pr checks 12",
      "gh run list",
      "./scripts/ci.sh --pr -m 'x'",
    ]) {
      assert.equal(bashSends(c), false, c);
    }
  });
});
