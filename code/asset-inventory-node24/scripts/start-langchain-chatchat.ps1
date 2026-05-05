$ErrorActionPreference = 'Stop'
$env:PYTHONPATH = 'E:/workspaceCodeing/code/asset-inventory-node24/integrations/Langchain-Chatchat/libs/chatchat-server;' + $env:PYTHONPATH
$env:STREAMLIT_CONFIG_DIR = 'E:/workspaceCodeing/code/asset-inventory-node24/integrations/Langchain-Chatchat/.streamlit'
$pythonExe = 'E:/git/Langchain-Chatchat/.venv/Scripts/python.exe'
$target = 'E:/workspaceCodeing/code/asset-inventory-node24/integrations/Langchain-Chatchat/libs/chatchat-server/chatchat/webui.py'
$cmd = 'echo.|"' + $pythonExe + '" -m streamlit run "' + $target + '" --server.port 8510 --server.address 127.0.0.1 --browser.gatherUsageStats false'
cmd /c $cmd
