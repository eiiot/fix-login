# Fix Stanford Login

A Chrome extension that prevents duplicate submissions and helps recover from Stanford sign-in errors.

[Add to Chrome](https://chromewebstore.google.com/detail/fix-stanford-login/lponbkmjhdkbkedbcjidlngaepbokjmg) · [View demo](https://fixlogin.stanf.org)

## How it works

Stanford tracks each step of a sign-in attempt. Double-clicking **Login** can submit a step that has already finished, causing a **Stale Request** error. Going back, copying a sign-in tab, or losing session cookies can also invalidate the form.

- **Prevents repeat submissions.** The first submission goes through unchanged. The extension blocks repeat submissions of the same form. A new form can be submitted normally.
- **Restarts failed sign-ins.** The extension remembers the Stanford service that started sign-in, such as a Canvas course page. If it detects a **Stale Request** or **CSRF token verification failed** error, it returns to that address to start a fresh sign-in attempt.

The extension allows two restarts per tab in 60 seconds. If it can't identify the service or reaches that limit, open the service again to restart sign-in.

Stanford's authentication checks remain in place.

## Privacy and limitations

The extension temporarily stores Stanford page addresses for each tab and removes them when the tab closes. It does not read entered usernames or passwords, inspect cookies, or send analytics.

Recovery works only for remembered addresses on `stanford.edu` and its subdomains. Some links containing authentication tokens can pass the address filter and be revisited during recovery. Real-account sign-in and Duo have not been tested.

## Run locally

1. Clone this repository.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Choose **Load unpacked** and select the `extension/` folder.

Run the unit tests:

```sh
npm test
```

## Source

- [`extension/login.js`](extension/login.js): blocks repeat submissions and detects sign-in errors.
- [`extension/background.js`](extension/background.js): remembers service addresses and restarts sign-in.
- [`extension/navigation.js`](extension/navigation.js): checks addresses and limits restarts.
- [`website/`](website/): homepage, demo videos, and privacy policy.
- [`scripts/`](scripts/): browser tests with empty sign-in fields, demo recording, and icon generation.
