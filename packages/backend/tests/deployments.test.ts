import { expect, test } from "bun:test";
import { deploymentIdentity, parseReport } from "../convex/deployments/validation";

const ref = "refs/heads/main";
const claims = {
  event_name: "push", repository: "customer/example", repository_id: "42", ref,
  workflow_ref: `customer/example/.github/workflows/deploy.yml@${ref}`,
  job_workflow_ref: `disposabl-dev/disposabl-exact/.github/workflows/deploy-managed.yml@${ref}`,
  sha: "f".repeat(40), run_id: "101", run_number: "10", run_attempt: "2",
};

test("only the trusted caller workflow identifies a production run or preview", () => {
  expect(deploymentIdentity(claims)).toEqual({
    repositoryId: 42, githubOwner: "customer", commitSha: claims.sha, run: { id: 101, number: 10, attempt: 2 }, pullRequest: undefined,
  });
  expect(deploymentIdentity({ ...claims, event_name: "pull_request", ref: "refs/pull/17/merge",
    workflow_ref: "customer/example/.github/workflows/deploy.yml@refs/pull/17/merge" })?.pullRequest).toBe(17);
  expect(deploymentIdentity({ ...claims, event_name: "pull_request_target" })).toBeNull();
  expect(deploymentIdentity({ ...claims, job_workflow_ref: claims.workflow_ref })).toBeNull();
  expect(deploymentIdentity({ ...claims, workflow_ref: claims.workflow_ref.replace("deploy.yml", "other.yml") })).toBeNull();
  expect(deploymentIdentity({ ...claims, repository_id: "12345678901234567890" })).toBeNull();
});

test("only successful reports can attach the platform's expected URL", () => {
  expect(parseReport({ platform: "android", status: "done", url: "https://www.appdrop.app/d/aB12" })?.url)
    .toBe("https://www.appdrop.app/d/aB12");
  expect(parseReport({ platform: "api", status: "done", url: "https://example.convex.site/openapi.json" })?.url)
    .toBe("https://example.convex.site/openapi.json");
  expect(parseReport({ platform: "ios", status: "done" })).toEqual({ platform: "ios", status: "done" });
  expect(parseReport({ platform: "web", status: "building", url: "https://example.convex.site/" })).toBeNull();
  expect(parseReport({ platform: "web", status: "done", url: "https://example.convex.site.other.example/" })).toBeNull();
  expect(parseReport({ platform: "android", status: "done", url: "https://appdrop.app/d/abc?token=abc" })).toBeNull();
});
