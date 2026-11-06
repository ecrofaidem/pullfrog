#!/usr/bin/env bash
# Run on the hypervisor as root; argument: file containing authorized public keys.
set -euo pipefail
[[ $EUID == 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
keys=${1:?Usage: sudo create-vm.sh /path/to/authorized_keys}
[[ -s $keys ]] || { echo 'Public key file is empty or missing.' >&2; exit 1; }
name=prfrog
vm_dir=/var/lib/libvirt/images/prfrog
if virsh dominfo "$name" >/dev/null 2>&1 || [[ -e $vm_dir ]]; then
  echo 'PR Frog VM or disk directory already exists; refusing to replace it.' >&2
  exit 1
fi
install -d -m 0755 "$vm_dir"
image=ubuntu-26.04-server-cloudimg-amd64.img
base=https://cloud-images.ubuntu.com/releases/26.04/release
curl -fL "$base/$image" -o "$vm_dir/$image"
curl -fsSL "$base/SHA256SUMS" -o "$vm_dir/SHA256SUMS"
(cd "$vm_dir"; grep -E " [*]?$image\$" SHA256SUMS | sha256sum --check -)
mv "$vm_dir/$image" "$vm_dir/root.qcow2"
qemu-img resize "$vm_dir/root.qcow2" 150G
python3 - "$keys" "$vm_dir" <<'PY'
import pathlib, sys, yaml
keys = pathlib.Path(sys.argv[1]).read_text().splitlines()
config = {
    'hostname': 'prfrog', 'manage_etc_hosts': True, 'timezone': 'Europe/Berlin',
    'ssh_pwauth': False, 'disable_root': True,
    'users': [{'name': 'ubuntu', 'groups': ['sudo'], 'shell': '/bin/bash',
               'sudo': ['ALL=(ALL) NOPASSWD:ALL'], 'lock_passwd': True,
               'ssh_authorized_keys': keys}],
    'package_update': True,
    'packages': ['docker.io', 'docker-compose-v2', 'qemu-guest-agent', 'curl',
                 'jq', 'git', 'restic', 'unattended-upgrades'],
    'write_files': [{
        'path': '/etc/apt/apt.conf.d/52-services-upgrades', 'permissions': '0644',
        'content': 'APT::Periodic::Update-Package-Lists "1";\n'
                   'APT::Periodic::Unattended-Upgrade "1";\n'
                   'Unattended-Upgrade::Automatic-Reboot "false";\n',
    }],
    'runcmd': [
        ['systemctl', 'enable', '--now', 'docker', 'qemu-guest-agent'],
        ['sh', '-c', 'curl -fsSL https://tailscale.com/install.sh -o /run/tailscale-install.sh && sh /run/tailscale-install.sh'],
        ['systemctl', 'enable', '--now', 'tailscaled'],
    ],
}
pathlib.Path(sys.argv[2], 'user-data').write_text('#cloud-config\n' + yaml.safe_dump(config))
pathlib.Path(sys.argv[2], 'meta-data').write_text('instance-id: prfrog-1\nlocal-hostname: prfrog\n')
PY
cloud-localds "$vm_dir/seed.iso" "$vm_dir/user-data" "$vm_dir/meta-data"
chown -R libvirt-qemu:kvm "$vm_dir"
virsh net-autostart default
if ! virsh net-info default | grep -Eq 'Active:.*yes'; then
  virsh net-start default
fi
virt-install --connect qemu:///system --name "$name" --memory 8192 --vcpus 4 \
  --cpu host-passthrough --import --osinfo detect=on,require=off \
  --disk "path=$vm_dir/root.qcow2,format=qcow2,bus=virtio" \
  --disk "path=$vm_dir/seed.iso,device=cdrom" \
  --network network=default,model=virtio \
  --graphics none --noautoconsole
virsh autostart "$name"
echo 'VM created. Find its address with: sudo virsh domifaddr prfrog'
