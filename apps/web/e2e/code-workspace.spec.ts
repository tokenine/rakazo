import { expect, type Page, test, type TestInfo } from "@playwright/test";
import { activeBotId, captureScreenshot, completeOnboarding, signup } from "./helpers";

const session = {
  id: "coding-e2e-1",
  workspaceId: "bot:bot-e2e",
  engine: "omp",
  status: "active",
  title: "Refactor",
};

/**
 * The coding-session RPCs are mocked: the workspace page is pure rendering
 * over them (R12), and no live sandbox computer is needed to verify the shell.
 */
async function mockWorkspaceRpc(page: Page) {
  await page.route("**/rpc/codingSessions/list", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ json: [session] }) }),
  );
  // No live PTY in this environment: the terminal panel stays disabled.
  await page.route("**/rpc/codingSessions/terminalUrl", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ json: { url: null } }) }),
  );
  await page.route("**/rpc/codingSessions/listFiles", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        json: [
          { path: "src", kind: "dir", size: 0, executable: true },
          { path: "README.md", kind: "file", size: 30, executable: false },
        ],
      }),
    }),
  );
  await page.route("**/rpc/codingSessions/readFile", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ json: { path: "README.md", content: "hello workspace" } }),
    }),
  );
  await page.route("**/rpc/codingSessions/gitGraph", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        json: {
          commits: [
            {
              sha: "abc1234def5678",
              parents: [],
              subject: "feat: first",
              author: "Porter",
              date: new Date().toISOString(),
            },
          ],
          refs: ["main"],
          dirty: 2,
          notRepo: false,
        },
      }),
    }),
  );
  await page.route("**/rpc/codingAcceptance/get", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ json: null }) }),
  );
  await page.route("**/rpc/computer/screenUrl", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ json: { url: null } }) }),
  );
}

test("the Chat/Code switch opens the workspace and its panels render", async ({
  page,
}, testInfo: TestInfo) => {
  await signup(page, `code-workspace-${Date.now()}@rakazo.test`, "password12", "Workspace");
  await completeOnboarding(page, testInfo);
  const botId = activeBotId(page);
  await mockWorkspaceRpc(page);

  await page.goto(`/app/${botId}`);
  const code = page.getByTestId("code-mode-code");
  await expect(code).toBeVisible();
  await captureScreenshot(page, testInfo, "01-chat-with-code-switch");

  // One visible action: the switch reattaches the active session's workspace.
  await code.click();
  await expect(page).toHaveURL(new RegExp(`/app/code/${session.id}$`));
  await expect(page.getByTestId("panel-terminal")).toBeVisible();
  await captureScreenshot(page, testInfo, "02-code-workspace");

  await page.getByTestId("panel-files").click();
  await page.getByTestId("file-entry-README.md").click();
  await expect(page.getByTestId("file-preview")).toContainText("hello workspace");

  await page.getByTestId("panel-git").click();
  const graph = page.getByTestId("git-graph");
  await expect(graph).toContainText("feat: first");
  await expect(graph).toContainText("abc1234");
  await expect(graph).toContainText("main");
  await captureScreenshot(page, testInfo, "03-workspace-files-git");
});
