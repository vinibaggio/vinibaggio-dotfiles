#!/bin/bash

# setup the basics
sudo apt-get update
sudo apt-get install -y build-essential curl file git autoconf software-properties-common mosh
sudo add-apt-repository -y ppa:jonathonf/vim

# setup linuxbrew

sh -c "$(curl -fsSL https://raw.githubusercontent.com/Linuxbrew/install/master/install.sh)"


# Install Docker
# sudo apt-get install \
#     apt-transport-https \
#     ca-certificates \
#     curl \
#     software-properties-common
#
# curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo apt-key add -
#
# sudo add-apt-repository \
#    "deb [arch=amd64] https://download.docker.com/linux/ubuntu \
#    $(lsb_release -cs) \
#    stable"
#
# sudo apt update
#
# sudo apt install docker-ce
