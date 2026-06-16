// DoD PKI root CA (DoD Root CA 6), used to validate the TLS chain DAIP presents
// for NOTAMs (api/daip.jcs.mil). A root CA certificate is PUBLIC — not a secret
// — so it's safe to commit; bundling it as a string (rather than a file read)
// avoids any runtime path/extraction issues on the hosting platform and makes
// NOTAMs work out-of-the-box. Operators can still override with DOD_CA_PEM /
// DOD_CA_PATH (e.g. to supply a fuller chain) — see lib/notams.ts.
//
// If DAIP fails cert validation in production with UNABLE_TO_GET_ISSUER_CERT,
// it likely presents intermediates chaining to a different/older root — append
// those PEMs here (or via DOD_CA_PEM) to extend the trust bundle.
export const DOD_CA_PEM_BUNDLED = `-----BEGIN CERTIFICATE-----
MIIFdTCCA12gAwIBAgIBATANBgkqhkiG9w0BAQwFADBbMQswCQYDVQQGEwJVUzEY
MBYGA1UEChMPVS5TLiBHb3Zlcm5tZW50MQwwCgYDVQQLEwNEb0QxDDAKBgNVBAsT
A1BLSTEWMBQGA1UEAxMNRG9EIFJvb3QgQ0EgNjAgFw0yMzAxMjQxNjM2MTdaGA8y
MDUzMDEyNDE2MzYxN1owWzELMAkGA1UEBhMCVVMxGDAWBgNVBAoTD1UuUy4gR292
ZXJubWVudDEMMAoGA1UECxMDRG9EMQwwCgYDVQQLEwNQS0kxFjAUBgNVBAMTDURv
RCBSb290IENBIDYwggIiMA0GCSqGSIb3DQEBAQUAA4ICDwAwggIKAoICAQC8qBu+
0w51OkG8fw3ReHS/itcp9AEFC4ETwumtfwlS+tmxBU3ulJPATIHC/TCOg6Tksvij
vwt8RJdmgOUQj1u/+PEo6C7tgBgM5t0RR3kYCFI2j1tRObJ4XVFEaLlKJF9kytCe
g78cZ/vlG55tUCTlhAVa09FB+p9YlX5TNjvvE577gB+veOIOQdF2uijeDqcN9ui8
axzuBJwLI5oju1CysBrQZ/yeObMN9/IIsvFT2ANdEVZ6QdChTtwmhdtAxFezlaio
JB4984TE5aN4K76Qea9vzmjQ1Pmn23tGczVNwpyRY7hOz5v7SanwZQTJ7xm6RUkT
LuHjFdVwf0x085t4DjhoXZ4WYkZqT0YGNHBngl3r0nMUSBxpbQ8lmOfh+D5irUrB
xUYPYBesrtC/L0sxQBzOMqUYbMupNz3lDilZPcueo9fNdyB4Fau932rW13/j9C8K
tzbAgYAPzmuuwRMxdS3JXB8r3Ztc/MIlsXxbXbqJMdUgLZ0zGVoS0Vp8Wvxt7eKI
r94GfQHavb2PX+3tG2BnOoJ4FgNrEbS2817nh61Lw80FHI7hbMmfYIaVXfkdquHG
OOj6ruCVXIjEInWv7Si6YfvzV+vhPub8fm4TnypKKqp+7USKHGx/hyIh/QDQvhrm
McYDAGN4JpIyxSWg+Ajqb7b+HQ8d+H7/NmnpsQIDAQABo0IwQDAdBgNVHQ4EFgQU
E088u9tdRSmllHC22qyeTOIvwQswDgYDVR0PAQH/BAQDAgGGMA8GA1UdEwEB/wQF
MAMBAf8wDQYJKoZIhvcNAQEMBQADggIBALac2eECg9Y3IQkM+2p7o6sh8DgXg4gl
2QM9pjooxYP9DrGfmakijvXIzfVNyH3kcziRT78q9Q+gI5Y6LLgsOSdYEPM10P6R
dQwapC776B4iVAnPwl/YQel6/mNGl2wNUoHC5XY/fpAkfMaAmHbTZM7qqdHIC7ht
vyTnAwaXxZEFrdWKx+SNFfDY3wJTsuP5+u+G5Gz/dG4Kgi/tXhS/9rhdpUMhFs7U
DIM5ccGRbHNwspX43JytVb61Tm0TmKggrdQ7dRSW/IFtjucjRbD5+cD8NXk1zhD+
2wVhZnKe/WMTv/YHRno1fwyehb+3PFyiuLEmqXEfxVD5B4fXqkhSl3BY10wSpvCp
vYt8G7CA0l0S2eLdrYUbbaWBwC3XtboLFDxdvvEJ3e9Ary5k4+hHhdtiYPaNv7HV
Vg7J8R8Pm9MCTk7A54K/dLXZwt6qQLI+NRQurFYMZD6/o40+puaugO/c4i93AtFg
T5OZGqPeI+TQ5f8wrLuUnoxo1qIyH/0xT2m4C8fqM07wi6UZcoeF61cIHSLEzg58
dsRNzH8ZGLP6i/r5v2Fvys8RSn5XKcO6OmYhUtYRoH2YWNn5hHd1ZzkXNA1XsHkb
YbtC5WKGy20xlU9SgvPfz+cNrdFtyWN7lAyMywMEA7KqmtQt8pJePcjbxzwdqoft
NKrk3ucpMoHF
-----END CERTIFICATE-----`;
