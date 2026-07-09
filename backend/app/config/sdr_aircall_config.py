"""
Roster and tag config for Quote Portal's own independent Aircall ingest.

This is a SEPARATE copy of the same config sdr-daily-report's sdr_config.py
holds — see sdr-kpi-lib's README for why that's a real, if smaller, risk:
the *logic* that uses this config is shared (sdr_kpi_lib), but the *values*
here still have to be kept in sync with the other repo by hand. If Aircall
tagging changes, or an SDR joins/leaves, both places need updating.

These values were extracted directly from the real sdr_config.py during
this integration, not guessed or left as placeholders.
"""

# Raw Aircall user display name -> canonical SDR name. Must match
# frontend/src/config/sdrs.js (or the sdrs table, once that migration
# happens) for names to line up correctly across the app.
AIRCALL_USER_MAP = {
    "Basilio Asuncion": "Basilio Asuncion",
    "Harhel Grace Manansala": "Harhel Grace Manansala",
    "Grace Manansala": "Harhel Grace Manansala",
    "Harhel Manansala": "Harhel Grace Manansala",
    "Maria Gladys Palmares": "Maria Gladys Palmares",
    "Lhoreto Bamiano": "Lhoreto Bamiano",
    "Stephanie Ong": "Stephanie Ong",
}

# Aircall tag names that count as a "connected" call.
CONNECTED_TAGS = {
    "Send Sample", "Reception/Gatekeeper", "Spoke with Contact",
    "Customer hang up", "Callback/Follow up", "DNC", "Not Interested",
    "Interested New Lead",
}

# Departed SDRs — calls attributed to them get rerouted to an "Unassigned"
# bucket instead of silently counting toward someone no longer on the team.
TERMINATED_SDRS = {"Lhoreto Bamiano", "Stephanie Ong"}
