#!/usr/bin/env python3

import os
import sys

# Add the virtual environment's site-packages to sys.path
venv_site_packages = os.path.abspath(os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    ".venv", "lib", "python3.10", "site-packages"
))

if os.path.exists(venv_site_packages):
    if venv_site_packages not in sys.path:
        sys.path.insert(0, venv_site_packages)
    print(f"Added virtual environment site-packages to Python path: {venv_site_packages}")