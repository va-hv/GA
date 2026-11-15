# Gatehouse

Gate and reception check-in for a warehouse or distribution centre. Visitors and contractors sign in at a reception
tablet, security checks truck drivers in, the dock coordinator clears each truck, and security releases it at the gate.
Admins manage people, tablets and settings; the **About** page (admins) explains what it does, how its data is kept and
how it is protected.

This guide covers two ways to run it:
- **A. On a server** (Ubuntu, in Azure or on site), for real use.
- **B. On a Mac**, to try it out or demo it.

---

## A. On a server

### A1. What you need

| | |
|---|---|
| Server | Ubuntu 24.04 or 22.04 LTS, 2 CPUs, 4 GB memory, 30 GB disk. In Azure, a B2s-size VM is enough for a pilot |
| Network | The server can reach the internet while installing. Staff and the reception tablet can reach it on port 443 |
| An address | Azure: the VM's DNS name, or your own name pointing at it. On site: the server's name or IP address |
| Access | SSH to the server with a user that can use `sudo` |

### A2. Prepare the server

**Azure**
1. Create a virtual machine: Ubuntu Server 24.04 LTS, size B2s, a region near the site, SSH key login.
2. Networking: allow inbound **HTTP (80)** and **HTTPS (443)** from the internet. Allow **SSH (22) only from your own IP
   address**.
3. On the VM's public IP, set a **DNS name label** (e.g. `gatehouse-pilot`). The address becomes
   `gatehouse-pilot.<region>.cloudapp.azure.com`.

**On site**
1. Install Ubuntu Server 24.04 LTS and give the machine a fixed IP address.
2. Make sure staff computers and the reception tablet can reach it on ports 443 and 80.
3. Optional: a name such as `gatehouse.yourcompany.local` pointing at it.

### A3. Install

On the server:

```bash
sudo apt-get update && sudo apt-get install -y git
sudo git clone https://github.com/va-hv/GA.git /opt/gatehouse
cd /opt/gatehouse
sudo bash ops/install.sh
```

The installer asks:
1. **Install Docker?** Yes.
2. **Address**: the address from A2.
3. **Certificate**: **1 (Let's Encrypt)** in Azure with a public DNS name; **2 (internal)** on site; **3** for your own
   certificate files (put them in `deploy/certs/cert.pem` and `deploy/certs/key.pem` first).
4. **Site name and first admin**: it prints a temporary password once. Write it down for the admin.
5. **Nightly backup**: say yes.

**Keep the backup key safe.** Run `sudo grep BACKUP_KEY /opt/gatehouse/.env` and store that line in a password
manager, away from the server. Without it no backup can be read.

### A4. Check it

```bash
cd /opt/gatehouse
sudo make prod-check
sudo make backup && sudo make restore-test
```

`prod-check` lists anything that still needs fixing. `restore-test` rebuilds a throwaway copy of the database from the
newest backup and tests it.

**On site with the internal certificate only:** browsers warn until each device trusts the server's certificate once.

```bash
sudo docker compose cp https:/data/caddy/pki/authorities/local/root.crt ./gatehouse-root.crt
```

Install `gatehouse-root.crt` as a trusted root certificate on each staff computer and the reception tablet.

### A5. First use

1. Open `https://<address>` and choose **Sign in as Admin**. Use the temporary password, choose your own, then set up
   two-step sign-in with an authenticator app (Microsoft Authenticator, Google Authenticator, 1Password...).
2. **Admin > People**: add the security guards and dock coordinators. Each gets a temporary password to hand over in
   person. Add a second admin too.
3. **Admin > Site settings**: site name, the safety rules the kiosk shows, the driver safety note, and how long photos
   and personal details are kept.
4. **Admin > Kiosks**: add the reception tablet. On the tablet, open `https://<address>/kiosk` and type the code.

### A6. Running it

- Nothing to do day to day. It restarts by itself after a reboot.
- The 02:30 backup lands in `/opt/gatehouse/backups/` (log: `backups/backup.log`). Copy backups off the server from time
  to time; they are encrypted.
- `sudo make prod-check` for a health check; `sudo make logs` to see what the app is doing.
- Lost phone: another admin uses **Admin > People > Reset two-step**. Forgotten password: **Reset password**.
- A password or phone may be compromised: **Admin > Signed in > Sign everyone else out**.

### A7. A new version

```bash
cd /opt/gatehouse && sudo git pull && sudo make update
```

It backs up first, then rebuilds and restarts; database changes apply by themselves. Your `.env` and backups stay.

### A8. When the pilot ends

- **Keep the data:** **Admin > Export** downloads everything the site holds as one file (it contains personal data;
  store it safely). The encrypted backups hold the same.
- **Remove everything:** `cd /opt/gatehouse && sudo docker compose down -v` permanently deletes the database and
  certificates. Then delete `/opt/gatehouse`. Only do this once you have an export or a backup you can read.

### A9. If something is wrong

| What you see | What to do |
|---|---|
| The browser can't reach the address | Ports 80 and 443 open (Azure: the VM's network rules)? DNS name pointing at the server? `sudo docker compose ps` all running? |
| Certificate warning on site | Trust `gatehouse-root.crt` on that device (A4) |
| Let's Encrypt fails | The DNS name must point at this server and port 80 must be open to the internet. `sudo docker compose logs https` says why |
| "Too many failed attempts" | Wait five minutes; it locks only that account from that device |
| Anything else | `sudo make logs` and `sudo make prod-check` |

---

## B. On a Mac

For trying it out, demos and training. This copy has no HTTPS, only this Mac can open it, and it stops when the Mac
sleeps: use a server for real use. Works on Apple silicon and Intel Macs.

### B1. Once: install the tools

1. Apple's command line tools: `xcode-select --install` (if it says they are installed, carry on).
2. Docker, one of:
   - **Docker Desktop** from https://www.docker.com/products/docker-desktop/ (install and open it once), or
   - **Colima**, free, with [Homebrew](https://brew.sh): `brew install colima docker docker-compose`

### B2. Get it and start it

```bash
git clone https://github.com/va-hv/GA.git ~/gatehouse
cd ~/gatehouse
bash ops/mac.sh
```

The script starts Docker if needed, creates the settings, builds and starts Gatehouse, then asks:
- **1) Demo site** with made-up trucks and visitors and one account per role (`demo-security`, `demo-dock`,
  `demo-admin`). It prints the password once.
- **2) Empty site** with your own admin (needs an authenticator app for two-step sign-in).

It then opens http://localhost:3600.

### B3. Every day

| | |
|---|---|
| Stop | `cd ~/gatehouse && make down` (data is kept) |
| Start again | Open Docker Desktop (or `colima start`), then `cd ~/gatehouse && make up` |
| Newer version | `cd ~/gatehouse && git pull && make up` |
| The kiosk | Admin > Kiosks > Add, then open http://localhost:3600/kiosk in another browser window and type the code |
| Start over, no data | `cd ~/gatehouse && docker compose down -v && bash ops/mac.sh` (`docker-compose` with Colima). Deletes this Mac's data |

---

## Commands

| | |
|---|---|
| `make prod-check` | Is the server ready? (settings, health, backups, HTTPS) |
| `make backup` / `make restore-test` | Encrypted backup now / prove the newest backup restores |
| `make schedule` | The line that runs the backup nightly (the installer adds it) |
| `make update` | Backup, rebuild, apply database changes, restart |
| `make site NAME='...' ADMIN=... ADMIN_NAME='...'` | Another site with its first admin |
| `make up` / `make down` / `make status` / `make logs` | Start / stop / what is running / what it is doing |
| `make test` / `make e2e` | Database rule tests / end-to-end tests (`make e2e` and `make demo` refuse on a server) |
