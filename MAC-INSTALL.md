# Gatehouse on a Mac: step by step

For trying Gatehouse out, demos and training. Copy each command, paste it into Terminal, press Return, and wait for it
to finish before the next one. The first time takes about 20 to 30 minutes, mostly downloads.

This Mac copy only works on this Mac (phones and tablets can't reach it) and stops when the Mac sleeps. For real use,
run it on a server: see [README.md](README.md).

## 1. Open Terminal

Press **Cmd + Space**, type **Terminal**, press Return.

## 2. Install Apple's developer tools

```bash
xcode-select --install
```

A window pops up: click **Install** and wait until it finishes. If Terminal says they are "already installed", go on to
step 3.

## 3. Install Homebrew (a free installer for Mac tools)

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

It asks for your Mac password (nothing shows while you type; that is normal). When it finishes, run these two lines so
Terminal can find Homebrew:

```bash
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
```

```bash
eval "$(/opt/homebrew/bin/brew shellenv)"
```

Check it worked (it should print a version number):

```bash
brew --version
```

On an older Intel Mac, use `/usr/local/bin/brew` instead of `/opt/homebrew/bin/brew` in the two lines above.

Already have Homebrew? Skip this step.

## 4. Install Docker (the engine that runs the app)

```bash
brew install colima docker docker-compose
```

Already have Docker Desktop installed and open? You can skip this step.

## 5. Download Gatehouse

```bash
git clone https://github.com/va-hv/GA.git ~/gatehouse
```

## 6. Start it

```bash
cd ~/gatehouse && bash ops/mac.sh
```

It starts Docker, builds the app and starts it (the first build takes several minutes). When it asks
**"Choose 1 or 2"**:

- **1** (recommended to look around): a demo site with made-up trucks and visitors.
- **2**: an empty site with your own admin (you need an authenticator app on your phone for two-step sign-in).

It prints a **password once: write it down**. Your browser opens http://localhost:3600. With the demo site, sign in
with any of these, all with that password:

| Account | Role |
|---|---|
| `demo-security` | Gate guard |
| `demo-dock` | Dock coordinator |
| `demo-admin` | Admin: People, Kiosks, Site settings, and the About page that explains the app |

**The reception kiosk:** sign in as admin, go to **Admin > Kiosks > Add**, then open http://localhost:3600/kiosk in
another browser window and type the code.

## Every day after that

Stop it (your data is kept):

```bash
cd ~/gatehouse && make down
```

Start it again, then open http://localhost:3600:

```bash
colima start && cd ~/gatehouse && make up
```

Get a newer version:

```bash
cd ~/gatehouse && git pull && make up
```

## If something goes wrong

| What you see | What to do |
|---|---|
| `command not found: brew` | Run the two lines in step 3 again, or close Terminal and open a new one |
| `command not found: make` or `git` | Step 2 did not finish: run `xcode-select --install` again |
| `Cannot connect to the Docker daemon` | Run `colima start` (or open Docker Desktop), then try again |
| The page does not open | Wait a minute and reload; or run `cd ~/gatehouse && make logs` to see what the app is doing |
| Lost the demo password | Start over with no data (below) |

Do not put `sudo` in front of these commands on a Mac.

**Start over with no data** (deletes this Mac's Gatehouse data):

```bash
cd ~/gatehouse && docker-compose down -v && bash ops/mac.sh
```
