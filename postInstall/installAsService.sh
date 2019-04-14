#!/bin/bash
# From DOS prompt type (git update-index --chmod=+x installAsService.sh) to make this file executable.
set -e
echo "NPM post install shell that installs this app as service starts now..."
#echo "Set irdclient as defalut group for weatherGauge -> sudo chown :irdclient ../weatherGauge"
#sudo chown :irdclient ../weatherGauge
#echo "Give default group write access to the weatherGauge directory -> sudo chmod g+w ../weatherGauge"
#sudo chmod g+w ../weatherGauge
echo "Install D-Bus config file for this service -> sudo cp ./postInstall/dbus.conf /etc/dbus-1/system.d/weatherGauge.conf"
sudo cp ./postInstall/dbus.conf /etc/dbus-1/system.d/weatherGauge.conf
echo "Install systemd service file -> sudo cp -n ./postInstall/server.service /etc/systemd/system/weatherGauge.service"
sudo cp -n ./postInstall/server.service /etc/systemd/system/weatherGauge.service
echo "Enable the servers to start on reboot -> systemctl enable weatherGauge.service"
sudo systemctl enable weatherGauge.service
#echo "Start the service now -> systemctl start weatherGauge.service"
#sudo systemctl start weatherGauge.service
echo "NPM Post install shell is complete."
echo "To start this servers please reboot the server. After reboot Type -> journalctl -u weatherGauge -f <- to see status."