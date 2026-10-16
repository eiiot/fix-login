# Fix Stanford Login

A quiet Chrome extension that prevents duplicate Stanford login submissions and restarts recognized failed login flows. Its only interface is a 🌲 toolbar icon.

[Website](https://fixlogin.stanf.org) · [Chrome Web Store](https://chromewebstore.google.com/detail/fix-stanford-login/lponbkmjhdkbkedbcjidlngaepbokjmg)

## Why login breaks

Stanford's login form belongs to a particular browser session and step in a login transaction. Submitting the form advances that step. A second click can submit the old step again and land on **Stale Request**.

Going Back, copying a login tab, or losing session cookies can also leave a form out of sync with the server. Some cases fail because the form's CSRF token no longer matches. Double submissions are one trigger, rather than the whole problem.

## How it works

1. **Prevent duplicate submissions.** On Stanford login pages, the extension lets the first form submission proceed unchanged and blocks repeat submissions of the same form. A newly rendered form can be submitted normally.
2. **Restart recognized failures.** The extension remembers the Stanford service URL that led to login, such as a Canvas course page. If login ends on the known **Stale Request** or **CSRF token verification failed** page, it returns to that service URL to start a fresh login transaction.

Recovery is limited to two attempts per tab in 60 seconds. If there is no eligible remembered destination, or the limit is reached, the error page stays in place.

Stanford still validates the login transaction, credentials, CSRF tokens, and MFA as usual. Recovery starts a new transaction; the rejected submission remains rejected.

## Privacy and limitations

The extension observes top-level Stanford navigation URLs and temporarily stores the recovery destination for each tab in browser-session memory. Records are removed when tabs close. It does not read typed usernames or passwords, inspect cookies, or send telemetry. The page script runs only on `login.stanford.edu/idp/profile/` pages.

Automatic recovery covers Stanford-hosted destinations only. The destination filter still needs hardening for unrecognized token-bearing URLs. Tests have covered failures using empty login fields; successful real-account login and Duo flows have not been tested.

## Run locally

1. Clone this repository.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Choose **Load unpacked** and select the `extension/` folder.

No build or dependency installation is needed. Run the unit tests with:

```sh
npm test
```

## Source

- [`extension/login.js`](extension/login.js): duplicate-submit prevention and error-page detection.
- [`extension/background.js`](extension/background.js): remembers destinations and performs recovery.
- [`extension/navigation.js`](extension/navigation.js): destination filtering and retry limits.
- [`website/`](website/): homepage, demo videos, and privacy policy.
- [`scripts/`](scripts/): credential-free browser probes, demo recording, and icon generation.

Generated ZIPs in `dist/` and browser captures in `evidence/` stay local and are excluded from Git.
