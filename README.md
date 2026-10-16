# Fix Stanford Login

A Chrome/Chromium Manifest V3 extension that runs quietly in the background. Its only interface is the 🌲 toolbar icon: no popup, settings, badges, injected controls, or notifications.

Generated ZIPs in `dist/` and browser captures in `evidence/` are excluded from Git. Evidence paths below refer to local test runs.

## Homepage and privacy policy

`website/` contains a standalone static site for `fixlogin.stanf.org`. The homepage shows two real, credential-free double-click recordings, side by side on desktop and stacked on mobile. Both videos are four seconds, with the click at about 1.5 seconds. They start and restart together, pause together when buffering, and correct playback drift using Before as the shared clock. Both use H.264 MP4s; playback respects reduced motion. The install button links to the published [Fix Stanford Login listing](https://chromewebstore.google.com/detail/fix-stanford-login/lponbkmjhdkbkedbcjidlngaepbokjmg). The privacy policy is `website/privacy.html`, served at `/privacy` by Cloudflare Pages.

The homepage includes Open Graph and Twitter card tags in its HTML, with an absolute image URL at `https://fixlogin.stanf.org/assets/share-preview-v2.png`. The 1200 × 630 PNG matches the white homepage, showing the title and before/after stills. Its editable HTML source is `store-assets/share-preview.html`; render that page at a 1200 × 630 viewport with a device scale of 1 to regenerate the image. The source is excluded from the deployment ZIP. Social previews have been verified locally; Fizz's actual rendering has not been tested.

Upload `dist/fixlogin-stanf-org.zip` with [Cloudflare Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/), then add `fixlogin.stanf.org` under the project's [Custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/). After deployment, use `https://fixlogin.stanf.org/privacy` in the Chrome Web Store. This site package has not been deployed from this workspace.

`node scripts/record-demos.mjs 100` captures fresh before/after demos in isolated headless browsers with empty login fields. It asserts two POSTs and a terminal stale-request page without the extension, and one POST with a usable form when the extension is enabled. Both sessions use the same 150 ms simulated network latency to reproduce the timing-dependent race. Captured frames are edited into the requested short loops; their timing is not a network-performance measurement. Both exports use the same BT.709 color settings. The visible cursor follows actual mouse input and persists across navigation; it is not part of the extension. This script requires `agent-browser`, `ffmpeg`, and Node 22 or later and is not included in the site ZIP. Sanitized recording reports are saved in `evidence/{before,after}-demo.json`.

Verified both videos play and seek, desktop/mobile layouts have no horizontal overflow, reduced motion leaves videos paused, and the privacy page renders. Site preview captures are in `evidence/website-*.png`.

The install button is black with square corners, a locally bundled [Chrome logo](https://www.google.com/chrome/static/images/chrome-logo.svg), and “Add to Chrome.” `website/store-button.js` changes the label to Edge, Brave, Opera, or Vivaldi when the desktop browser identifies itself through client hints, its user agent, or Brave's documented API. Browsers that hide their identity, mobile browsers, and pages without JavaScript retain “Add to Chrome.” This check stays on the device, uses no storage, and does not change the store URL. Native video controls are hidden.

## Install version 0.1.0

1. Open `chrome://extensions` in Chrome or a compatible Chromium browser.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this project's `extension/` folder.
4. Pin **Fix Stanford Login** if you want its tree icon visible.

The distributable ZIP is `dist/stanford-login-tree-0.1.0.zip`. Extract it to a permanent folder and load that folder using the same steps. No build or npm install is required to use the extension. [Chrome's unpacked-extension instructions](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked) describe the browser workflow.

## What the extension does

- Allows the first Stanford login form submission unchanged, then blocks repeat submissions of that form until navigation. An ordinary incorrect-password response remains usable.
- Recognizes the observed **Stale Request** and **CSRF token verification failed** pages and restarts through the Stanford service URL that initiated the login.
- Remembers the first service URL in a redirect chain, retaining a deep link when that URL started the chain. Tabs opened from another tab inherit its service context.
- Uses browser-session storage, removes closed-tab records, and permits at most two automatic recoveries per tab in a rolling 60-second window.

It does not read typed usernames or passwords, inspect cookies, save CSRF tokens, replay SAML requests, or send telemetry. It observes top-level Stanford navigation URLs to remember the service and uses `storage` and `webRequest` permissions, with host access limited to HTTPS Stanford domains. The injected submit/error handler runs only on `login.stanford.edu/idp/profile/` pages.

Recovery creates a new login transaction; you may need to enter credentials again. If the originating service is unknown, or the retry limit is reached, the extension leaves the error page in place. Direct IdP bookmarks opened without service context and services hosted outside Stanford domains are outside this version's recovery coverage. Successful real-account authentication and Duo still need testing.

## Extension verification

`npm test` runs four focused tests covering destination preservation, rejection of authentication callback URLs and lookalike domains, the IdP boundary, and the sliding retry limit. The browser probes load the actual unpacked extension into isolated headless Chrome, without Stanford credentials:

```sh
npm test
STANFORD_EXTENSION_PATH="$PWD/extension" node scripts/click-timing.mjs 100
STANFORD_EXTENSION_PATH="$PWD/extension" node scripts/state-scenarios.mjs refresh-current-form two-sequential-current-submits get-old-step-after-submit back-then-submit background-get-then-submit lose-jsessionid-then-refresh replay-original-saml-request duplicate-tab-with-opener recovery-budget unknown-destination many-independent-flows independent-login-tabs duplicate-tab-submit-original-first duplicate-tab-submit-copy-first
```

Verified extension behavior on October 5, 2026:

| Check | Result |
| --- | --- |
| Two trusted clicks separated by 100 ms | One POST; ordinary login form remains |
| Current-form refresh and sequential current-form submissions | Ordinary login behavior preserved |
| Old-step GET and Back followed by old-form submission | Automatically restarted to a fresh login form |
| Background GET followed by CSRF-invalid submission | Automatically restarted to a fresh login form |
| Lost session cookie and reused initial SAML request | Automatically restarted to a fresh login form |
| Duplicate tabs, in both submission orders, and a tab with an opener | Automatically recovered affected forms |
| Independent login tabs | Both remain usable |
| First flow evicted after newer login attempts | Automatically restarted to a fresh login form |
| Three forced failures within 60 seconds | Two recoveries; third left in place |
| Direct execution URL in a fresh browser without a destination | Left in place; no guessed service or redirect loop |

Evidence: `evidence/extension-double-click-100ms-1791258718994.{json,png}`, the passing cases in `evidence/extension-state-scenarios-1791258789645/`, and all five passing cases in `evidence/extension-state-scenarios-1791258878507/`. The first batch's `unknown-destination` setup actually inherited an opener and was superseded by the fresh-browser check in the second batch. Captures contain sanitized request metadata and screenshots, not credentials or token values.

## Original failure investigation

Reproduced against the live Stanford login service on October 5, 2026, using Chrome for Testing 152.0.7977.64 on macOS. No Stanford credentials were needed.

## Reproduce manually

1. Open https://canvas.stanford.edu and choose **SUNet Login**.
2. Leave both SUNet ID and Password empty.
3. Quickly click **Login** twice.
4. When the second submission overlaps the first navigation, the page title becomes **Stanford Login - Stale Request**, and the login form disappears. The page asks you to start again from the website you wanted to reach.

This is a timing-dependent failure. A fast machine double-click can collapse into a single outgoing submission and leave the normal login form with an incorrect-credentials message. Two deliberately spaced clicks reproduced the terminal error.

## Automated timing probe

Requires Node.js with its built-in WebSocket implementation (Node 22 or newer), `agent-browser` on PATH, and its installed browser. These are already available on this machine.

From this directory:

```sh
# Two actual mouse clicks, with a 100 ms pause between dispatches.
node scripts/click-timing.mjs 100

# Single-click control.
node scripts/click-timing.mjs 100 --single
```

Each run opens a fresh, isolated browser session through Canvas's actual SUNet entry point, checks that both credential fields are empty, dispatches trusted mouse events through Chrome DevTools Protocol, saves a JSON timeline and a screenshot in `evidence/`, and closes that session. The report's `result.reproducedDuplicateSubmitFailure` indicates whether two POSTs ended on the stale-request page. Timing and network conditions can change the outcome; pass a different delay if needed.

Request logging retains document request methods, status codes, execution-step identifiers, relative times, and URL query parameter names. It omits request/response bodies, cookies, headers, CSRF values, and SAML parameter values.

## Observed results

| Case | Result | Evidence |
| --- | --- | --- |
| Single click, empty fields, fresh flow | One POST; ordinary incorrect-credentials feedback; login form remains | `evidence/single-click-1791257809430.json` and `.png` |
| Two clicks, 100 ms configured pause, existing retry form | Two POSTs to the same execution step; stale-request page | `evidence/double-click-100ms-1791257776443.json` and `.png` |
| Two clicks, 100 ms configured pause, fresh flow | Two POSTs to the same execution step; stale-request page | `evidence/double-click-100ms-1791257821020.json` and `.png` |
| Open a captured execution URL in another fresh session | Stale-request page without submitting credentials | `evidence/missing-session-stale-request.png` |
| Restart from `https://canvas.stanford.edu/login/1` in that session | Normal Stanford login form restored | Verified live; no screenshot recorded |

## What the requests show

The first double-click capture gives the clearest sequence:

```text
  0 ms  POST execution=e1s3
 85 ms  302 redirect / GET execution=e1s4
        First navigation canceled by the next submission
100 ms  POST execution=e1s3
222 ms  200 response containing the stale-request page
```

The single-click control advances from `e1s2` to `e1s3` and retains a usable form. The duplicate submissions reuse the prior step. This supports a consumed-login-step race as the explanation for this failure; server internals were not inspected. The error page returns HTTP 200, so its status code alone cannot identify the failure.

Opening a captured execution URL in a fresh browser also fails because that browser lacks the associated flow session. Starting again from Canvas restores the login form. An extension will likely need both duplicate-submit prevention and a way to restart known failed flows from the originating service.

Successful authenticated login, Duo, Axess, and other browsers have not been tested. The investigation below covers additional credential-free triggers for both stale-request and CSRF processing errors.

## Core issue: the page must match the live login transaction

The broader investigation found three pieces of state that must agree:

- **Browser session:** Stanford uses an HttpOnly `__Host-JSESSIONID` cookie. The server uses this session to locate a flow. Removing this cookie makes even a GET of the current login step fail.
- **Execution key:** `execution=e1s2` identifies a flow (`e1`) and state (`s2`) within that session. A submission advances the state, and requests using the previous state fail. The URL is a reference to a live transaction, rather than a reusable sign-in address.
- **CSRF token:** Each form contains a hidden token. Re-rendering the same step can change the server's token without changing the execution URL. An older copy of the form can then fail even though its session and step are still correct.

The observations match [Shibboleth's explanation of Web Flow execution](https://shibboleth.atlassian.net/wiki/spaces/IDP5/pages/5158895619/UnderstandingWebFlowExecution) and [CSRF token scope](https://shibboleth.atlassian.net/wiki/spaces/IDP5/pages/3199501137). That CSRF documentation explicitly describes browser prefetching as a source of token problems and documents `idp.csrf.token.perFlow=true` in version 5.2+ as a server-side mitigation. Stanford's installed version and configuration were not inspected, so applicability of that setting is conditional.

The initial SAML authentication request also has replay and freshness checks. [Shibboleth's troubleshooting documentation](https://shibboleth.atlassian.net/wiki/spaces/IDP5/pages/3199511039) explains that the same stale-request screen covers several failure classes, including expired/replayed messages, missing or expired servlet sessions, and load-balancer conversation loss. These are not all duplicate submissions.

## Additional reproductions and controls

All cases below were tested using empty credential fields in isolated **headless** browsers. Use the referenced captures for conclusions; earlier exploratory captures are not part of this verified matrix.

| Action | Observed result | Explanation supported by the evidence |
| --- | --- | --- |
| Refresh an untouched current form | Usable form remains | Current session and step still exist |
| Submit twice sequentially, using the newly rendered form each time | Usable form remains; POSTs use `e1s2`, then `e1s3` | Two POSTs alone do not cause the failure |
| Submit once, then navigate directly to the previous step URL | Stale Request on GET | Old step is invalid; no duplicate POST needed |
| Submit once, Back, submit the restored form | Back shows a cached old form; submission gives Stale Request | A visible form does not prove server-side state is valid |
| Copy the current login URL into another tab | Both initially display forms | Same flow and step can render twice |
| After copying, submit the original tab first | Processing Error: CSRF token verification failed | The second render changed the token for the same execution URL |
| After copying, submit the newest tab first, then the original | Newest advances successfully; original gets Stale Request | The older tab retains an invalid step |
| Fetch the current login URL in the background, then click Login once | Processing Error: CSRF token verification failed | Background GET changed the token; visible URL and DOM token did not change |
| Start two independent login flows through Canvas in separate tabs and submit each | Both remain usable | Separate conversations do not inherently conflict |
| Delete only `__Host-JSESSIONID`, then refresh | Stale Request; only a GET occurred | Execution key no longer has its associated browser session |
| Clear the isolated browser's cookies, then submit | Stale Request | Single POST cannot recover the lost session |
| Revisit the original SAML redirect URL instead of starting again from Canvas | Stale Request; only a GET occurred | Consistent with SAML replay rejection; server logs would confirm the precise rejection |
| Start five more independent flows, then revisit the first | First flow becomes stale; session cookie unchanged | Consistent with eviction at a five-conversation limit |

The first flow remained accessible after one, two, three, and four new flows, then failed after the fifth new flow. This is an observed boundary, not a guarantee about Stanford's configuration. Spring Web Flow documents removal of the oldest execution when the per-session limit is exceeded in its [reference guide](https://docs.spring.io/spring-webflow/docs/2.3.x/reference/pdf/spring-webflow-reference.pdf).

The background-fetch probe measured all of the following: GET returned 200, response execution URL matched the visible URL, visible URL stayed unchanged, original DOM token stayed unchanged, response contained a different token, and the subsequent single POST failed with the CSRF error. It simulates a background fetch; it does not establish that automatic prefetching in a particular browser caused Stanford users' incidents.

Run the full matrix or select scenarios:

```sh
node scripts/state-scenarios.mjs
node scripts/state-scenarios.mjs get-old-step-after-submit lose-jsessionid-then-refresh
node scripts/state-scenarios.mjs background-get-then-submit duplicate-tab-submit-copy-first
```

Verified request traces, page text, and screenshots:

- `evidence/state-scenarios-1791258139741/`: navigation, cookie-loss, independent-flow, and flow-eviction tests.
- `evidence/state-scenarios-1791258236020/`: both duplicate-tab submission orders, background GET, and a clean GET-only SAML replay.

Cookie and token values are used only transiently to perform the probes or compare equality. Reports retain metadata and comparison booleans, not their values. Server logs were not available; mappings from observed behavior to server exception types remain inferences.

## Recovery design

Preventing duplicate submissions covers the double-click path. Version 0.1.0 also remembers the initiating service, recognizes the observed terminal stale-request and CSRF failures, and restarts through a fresh service entry point. Refreshing the failing execution URL or resending an old POST preserves the invalid transaction. Recovery has a bounded retry count to avoid loops if the session or service remains broken. The extension does not store or replay credentials, CSRF tokens, or old SAML requests.
