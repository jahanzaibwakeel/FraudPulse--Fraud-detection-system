# FraudPulse Screenshots

Generate current dashboard screenshots from a running local stack:

```bash
docker compose up -d --build
npm run screenshots
```

The script writes:

- `01-live-dashboard.png`
- `02-alert-center.png`
- `03-model-performance.png`
- `04-security-console.png`

These images are intentionally regenerated from the app instead of hand-edited so the portfolio screenshots stay aligned with the product.
