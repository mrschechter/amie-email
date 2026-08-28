# AMENDMENT 1 to SPEC-AMIE-STANDUP.md — replace cloudflared with caddy TLS

Discovery after the spec was written: our Cloudflare API token cannot create
Tunnels. New edge architecture: Cloudflare proxied DNS -> box public IP, EC2
security group already restricts inbound 443 to Cloudflare IP ranges, and a
Let's Encrypt cert for email.tryamie.com already exists ON THE BOX at
`/etc/dittofeed/certs/fullchain.pem` and `/etc/dittofeed/certs/privkey.pem`
(auto-renewed by acme.sh; renewal runs `docker compose restart caddy`).

Changes to `deploy/` (only):
1. In `docker-compose.prod.yaml`: REMOVE the cloudflared service. ADD a `caddy`
   service: image `caddy:2` pinned to a specific current 2.x tag, restart
   always, same logging options as other services, publishes `443:443`
   (0.0.0.0 is fine — SG does the filtering), mounts:
   - `./Caddyfile:/etc/caddy/Caddyfile:ro`
   - `/etc/dittofeed/certs:/certs:ro`
   - named volumes `caddy_data:/data`, `caddy_config:/config`
   depends_on lite (service_healthy). Remove `CLOUDFLARE_TUNNEL_TOKEN` from env
   requirements everywhere.
2. NEW `deploy/Caddyfile`:
   ```
   email.tryamie.com:443 {
     tls /certs/fullchain.pem /certs/privkey.pem
     reverse_proxy lite:3000
   }
   ```
   Disable the admin API (`admin off` global option) and turn off auto-HTTPS
   cert management (we bring our own cert files).
3. Keep the lite service's `127.0.0.1:3000:3000` binding (handy for on-box
   debugging).
4. Update `.env.example` and `README.md` to match (drop tunnel wording; explain
   the CF-proxied-DNS + SG-restricted + caddy-TLS edge and the cert paths).

Fences: same as before — deploy/ files only, no commits. Validate YAML the same
way you did before, plus `caddy validate` if a caddy binary is available
(unlikely — if not, say so).
