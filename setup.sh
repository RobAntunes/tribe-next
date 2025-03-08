#!/bin/bash

echo "MightyDev Setup Script"
echo "======================"

# Run Python setup script
echo "Setting up Python dependencies..."
python3 setup.py

if [ $? -ne 0 ]; then
    echo "❌ Python setup failed. Please fix the errors and try again."
    exit 1
fi

# Run API key setup script
echo -e "\nSetting up API keys..."
python3 set_api_keys.py

if [ $? -ne 0 ]; then
    echo "❌ API key setup failed. Please fix the errors and try again."
    exit 1
fi

echo -e "\n✅ MightyDev setup completed successfully!"
echo "You can now use the MightyDev extension."
echo "If you experience any issues, run this setup script again."