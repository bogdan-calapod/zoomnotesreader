import { extractOwnerActionItems } from "../src/parser.js";

// The plain-text rendering of the real Zoom summary email sample.
const SAMPLE = `Meeting assets for BREADS 🍞 are ready!

Meeting summary

Quick recap

The meeting focused on the project to implement hierarchical breadcrumbs in Connect to address navigation confusion and reduce UX General complaints.

Next steps

Bogdan Calapod

Create a new milestone in the Linear project and create tasks linked to the Linear issues for the breadcrumbs project.https://tasks.zoom.us?meetingId=beTwYvcZQ1Kh%2B8z4AFcYBA%3D%3D&stepId=487d16f1-9a65-11f1-91ad-9af137077747
Share the link to the milestone with all the issues with Walker within an hour or two.https://tasks.zoom.us?meetingId=beTwYvcZQ1Kh%2B8z4AFcYBA%3D%3D&stepId=487d1888-9a65-11f1-ba36-9af137077747
Prepare the team to start working on the project next week (Monday).https://tasks.zoom.us?meetingId=beTwYvcZQ1Kh%2B8z4AFcYBA%3D%3D&stepId=487d1b1f-9a65-11f1-955f-9af137077747
Notify the Windows Updates team about the upcoming changes for review and approval.https://tasks.zoom.us?meetingId=beTwYvcZQ1Kh%2B8z4AFcYBA%3D%3D&stepId=487d1d94-9a65-11f1-a442-9af137077747
Walker

Send the Figma link to Bogdan Calapod.https://tasks.zoom.us?meetingId=beTwYvcZQ1Kh%2B8z4AFcYBA%3D%3D&stepId=487d13db-9a65-11f1-a602-9af137077747
Chat with Chloe about the Windows Updates page changes to coordinate the UI update.https://tasks.zoom.us?meetingId=beTwYvcZQ1Kh%2B8z4AFcYBA%3D%3D&stepId=487d19d8-9a65-11f1-8cee-9af137077747
Finalize the design mocks based on the Linear issues and share them with the team.https://tasks.zoom.us?meetingId=beTwYvcZQ1Kh%2B8z4AFcYBA%3D%3D&stepId=487d1c5b-9a65-11f1-9c54-9af137077747
Provide design review for the PR once it's ready, and review the Figma reviewer.https://tasks.zoom.us?meetingId=beTwYvcZQ1Kh%2B8z4AFcYBA%3D%3D&stepId=487d1ec8-9a65-11f1-b960-9af137077747
Summary

Customer Survey UX Analysis

Walker began discussing a project related to the voice of the customer survey dataset.`;

function run() {
  let pass = 0;
  let fail = 0;
  const check = (name, cond) => {
    if (cond) { pass++; console.log(`  ✓ ${name}`); }
    else { fail++; console.log(`  ✗ ${name}`); }
  };

  const items = extractOwnerActionItems(SAMPLE, "Bogdan Calapod");

  console.log("\nExtracted items for Bogdan Calapod:");
  items.forEach((it, i) => {
    console.log(`  [${i + 1}] ${it.text}`);
    console.log(`        link: ${it.link ? it.link.slice(0, 60) + "..." : "(none)"}`);
  });
  console.log("");

  check("extracts exactly 4 items", items.length === 4);
  check("item 1 is the milestone task", /Create a new milestone/.test(items[0]?.text));
  check("item 1 has no trailing URL in text", items[0] && !/https?:\/\//.test(items[0].text));
  check("item 1 captured the zoom link separately", /tasks\.zoom\.us/.test(items[0]?.link || ""));
  check("item 4 is the Windows Updates notify", /Notify the Windows Updates team/.test(items[3]?.text));
  check("does NOT include any of Walker's items",
    !items.some((it) => /Send the Figma link|Chat with Chloe|Finalize the design mocks|Provide design review/.test(it.text)));

  // Negative case: a person with no section should yield nothing.
  const none = extractOwnerActionItems(SAMPLE, "Chloe Griffin");
  check("returns 0 items for a person not in Next steps", none.length === 0);

  // Negative case: email with no Next steps block.
  const noNext = extractOwnerActionItems("Meeting summary\n\nQuick recap\n\nSome prose.", "Bogdan Calapod");
  check("returns 0 items when there is no Next steps block", noNext.length === 0);

  // Bullet-marker stripping: Zoom sometimes prefixes items with *, -, or •.
  const BULLETS = `Next steps

Bogdan Calapod

* Draft the RFC and circulate it.
- Book the room for the review.
• Ping design for the mocks.

Summary

Recap prose.`;
  const bulletItems = extractOwnerActionItems(BULLETS, "Bogdan Calapod");
  check("strips bullets: extracts 3 items", bulletItems.length === 3);
  check("strips leading '* '", bulletItems[0]?.text === "Draft the RFC and circulate it.");
  check("strips leading '- '", bulletItems[1]?.text === "Book the room for the review.");
  check("strips leading '• '", bulletItems[2]?.text === "Ping design for the mocks.");
  check("no residual bullet markers", bulletItems.every((it) => !/^\s*[*\-•]/.test(it.text)));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

run();
