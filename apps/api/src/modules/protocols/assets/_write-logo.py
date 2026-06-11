#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
# SPDX-License-Identifier: EUPL-1.2

# Jednorazový script — spusti raz, potom zmaž.
# Dekóduje base64 PNG a uloží ho ako binárny súbor.
import base64, os

data = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAPAAAAA8CAIAAADXHaAKAAAAm0lEQVR42u3SAQ0AMAgDQZQgBImY"
    "3lSMLOQuVdB8ZLXZmoULTNBmgjYTtJmgTdBmgjb7LugDiwgaQYOgQdAgaAQNggZBg6BB0AgaBA2C"
    "BkGDoBE0CBoEDYIGQSNoEDQIGgQNgkbQIGgQNAgaBI2gQdAgaBA0CBpBg6BB0CBoBA2CBkGDoEHQ"
    "CBoEDYKGd0FntdmaCdoEbSZos4Fdxvxv8Q6nuA4AAAAASUVORK5CYII="
)

out = os.path.join(os.path.dirname(__file__), "inventario-logo-default.png")
with open(out, "wb") as f:
    f.write(data)
print(f"Written {len(data)} bytes to {out}")
