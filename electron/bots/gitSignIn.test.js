/**
 * gitSignIn.test.js — a bot's git and gh sign in with its GitHub provider's
 * token (DASH-55). The helper is checked against the real git.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const {
  gitTokenFor,
  gitSignInEnv,
  redact,
  signInProblem,
} = require("./gitSignIn");

const TOKEN = "github_pat_TEST123456789";

describe("gitTokenFor", () => {
  const providers = {
    Notes: { provider: { type: "filesystem", credentials: {} } },
    "My GitHub": {
      provider: { type: "github", credentials: { token: TOKEN } },
    },
    "Empty GitHub": { provider: { type: "github", credentials: {} } },
  };
  const getProvider = async (name) =>
    providers[name] || { error: true, message: "not found" };

  it("the first of the bot's own providers that is GitHub with a token", async () => {
    const bot = { mcpServers: ["Notes", "Empty GitHub", "My GitHub"] };
    assert.equal(await gitTokenFor({ bot, getProvider }), TOKEN);
  });

  it("none: no GitHub provider, one without a token, a missing one, a throw", async () => {
    assert.equal(
      await gitTokenFor({ bot: { mcpServers: ["Notes"] }, getProvider }),
      null,
    );
    assert.equal(
      await gitTokenFor({ bot: { mcpServers: ["Empty GitHub"] }, getProvider }),
      null,
    );
    assert.equal(
      await gitTokenFor({ bot: { mcpServers: ["Gone"] }, getProvider }),
      null,
    );
    assert.equal(
      await gitTokenFor({
        bot: { mcpServers: ["My GitHub"] },
        getProvider: async () => {
          throw new Error("locked");
        },
      }),
      null,
    );
    assert.equal(await gitTokenFor({ bot: {}, getProvider }), null);
  });

  it("a GitHub provider the bot doesn't have isn't used", async () => {
    assert.equal(
      await gitTokenFor({ bot: { mcpServers: [] }, getProvider }),
      null,
    );
  });
});

describe("gitSignInEnv", () => {
  it("gh gets GH_TOKEN; git never prompts; the token isn't in any config value", () => {
    const env = gitSignInEnv(TOKEN);
    assert.equal(env.GH_TOKEN, TOKEN);
    assert.equal(env.GIT_TERMINAL_PROMPT, "0");
    for (const [k, v] of Object.entries(env)) {
      if (k.startsWith("GIT_CONFIG_")) assert.ok(!v.includes(TOKEN), k);
    }
  });

  it("keeps GIT_CONFIG_* entries the environment already has", () => {
    const env = gitSignInEnv(TOKEN, { GIT_CONFIG_COUNT: "2" });
    assert.equal(env.GIT_CONFIG_COUNT, "6");
    assert.equal(env.GIT_CONFIG_KEY_0, undefined);
    assert.equal(env.GIT_CONFIG_KEY_2, "credential.https://github.com.helper");
  });

  it("no token, nothing", () => {
    assert.deepEqual(gitSignInEnv(null), {});
    assert.deepEqual(gitSignInEnv(""), {});
  });

  // The real git: github.com gets the token ahead of the computer's own
  // helper, other hosts keep theirs, and git@github.com: goes over https.
  it("with the real git", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "git-signin-"));
    try {
      const global = path.join(dir, "gitconfig");
      fs.writeFileSync(
        global,
        '[credential]\n\thelper = "!f() { echo username=someone; echo password=KEYCHAIN; }; f"\n',
      );
      const env = {
        PATH: process.env.PATH,
        HOME: dir,
        GIT_CONFIG_GLOBAL: global,
        GIT_CONFIG_NOSYSTEM: "1",
        ...gitSignInEnv(TOKEN),
      };
      const fill = (url) =>
        execFileSync("git", ["credential", "fill"], {
          env,
          input: `url=${url}\n\n`,
        }).toString();
      const gh = fill("https://github.com/owner/repo.git");
      assert.match(gh, /^username=x-access-token$/m);
      assert.match(gh, new RegExp(`^password=${TOKEN}$`, "m"));
      assert.match(
        fill("https://gitlab.com/owner/repo.git"),
        /password=KEYCHAIN/,
      );
      const url = (u) =>
        execFileSync("git", ["ls-remote", "--get-url", u], { env })
          .toString()
          .trim();
      assert.equal(
        url("git@github.com:owner/repo.git"),
        "https://github.com/owner/repo.git",
      );
      assert.equal(
        url("ssh://git@github.com/owner/repo.git"),
        "https://github.com/owner/repo.git",
      );
      // store and erase print nothing (and so store nothing).
      const store = execFileSync("git", ["credential", "approve"], {
        env,
        input: `url=https://github.com/owner/repo.git\nusername=x\npassword=y\n\n`,
      }).toString();
      assert.equal(store, "");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("redact", () => {
  it("takes the token out of strings, arrays and objects, deeply", () => {
    const ev = {
      type: "tool_result",
      output: `echo ${TOKEN} and ${TOKEN}`,
      input: { command: `curl -H "Authorization: ${TOKEN}"`, list: [TOKEN, 3] },
    };
    const out = redact(ev, TOKEN);
    assert.ok(!JSON.stringify(out).includes(TOKEN));
    assert.equal(out.output, "echo [GitHub token] and [GitHub token]");
    assert.equal(out.input.list[1], 3);
    assert.ok(JSON.stringify(ev).includes(TOKEN), "the input isn't changed");
  });

  it("no token (or a too-short one): as it was", () => {
    const ev = { text: "abc" };
    assert.equal(redact(ev, null), ev);
    assert.equal(redact(ev, "ab"), ev);
  });
});

describe("signInProblem", () => {
  const refused =
    "remote: Invalid username or token.\nfatal: Authentication failed for 'https://github.com/o/r.git/'";
  it("a refused sign-in says where to fix it", () => {
    assert.match(signInProblem(refused, { hasToken: true }), /check the token/);
    assert.match(
      signInProblem(
        "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
        { hasToken: false },
      ),
      /give this bot a GitHub provider/,
    );
  });
  it("anything else: null", () => {
    assert.equal(
      signInProblem("Everything up-to-date", { hasToken: true }),
      null,
    );
    assert.equal(signInProblem("", { hasToken: false }), null);
  });
});

describe("command checks sign in like the bot's own commands (DASH-66)", () => {
  const { runCheck } = require("../checks/checkRunner");
  const os = require("os");
  const TOKEN = "ghp_checkTokenForTests123456";

  it("a command check gets the token for git and gh, and it never stays in what the check keeps", async () => {
    const res = await runCheck(
      {
        kind: "command",
        command:
          'echo "token: $GH_TOKEN"; [ "$GH_TOKEN" = "$DASH_GIT_TOKEN" ] && [ -n "$DASH_GIT_TOKEN" ] && git config --get-urlmatch credential.helper https://github.com/x | grep -q DASH_GIT_TOKEN',
      },
      {},
      {
        cwd: os.tmpdir(),
        tmpDir: os.tmpdir(),
        env: gitSignInEnv(TOKEN, process.env),
        secret: TOKEN,
      },
    );
    assert.equal(res.pass, true, res.reason + " " + (res.output || ""));
    assert.doesNotMatch(JSON.stringify(res), new RegExp(TOKEN));
    assert.match(res.output, /token: \[GitHub token\]/);
  });

  it("a bot without one gets nothing new", async () => {
    const res = await runCheck(
      { kind: "command", command: '[ -z "$DASH_GIT_TOKEN" ]' },
      {},
      { cwd: os.tmpdir(), tmpDir: os.tmpdir() },
    );
    assert.equal(res.pass, true);
  });
});
