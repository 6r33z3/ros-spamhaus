# ros-spamhaus

![build](https://github.com/6r33z3/ros-spamhaus/actions/workflows/build.yml/badge.svg)

Converts the upstream blacklist [v4](https://www.spamhaus.org/drop/drop_v4.json) and [v6](https://www.spamhaus.org/drop/drop_v6.json) from [Spamhaus](https://www.spamhaus.org/) as dynamic address lists for blocking in RouterOS with daily updates.

Tested on RB5009UPr+S+ (7.20.8). Each update cycle cost about 10s.

## script

Note: Fetch onto `tmpfs` could help minimizing NAND wearing , e.g.:

```routeros
/disk add type=tmpfs tmpfs-max-size=16M slot=tmpfs
```

```routeros
:local baseUrl "https://raw.githubusercontent.com/6r33z3/ros-spamhaus/refs/heads/build"
:local basePath "usb1-disk/spamhaus"
:local versions {"v4";"v6"}

:foreach version in=$versions do={
  :local fileName "spamhaus-drop-$version.rsc"
  /tool fetch url="$baseUrl/$fileName" dst-path="$basePath/$fileName" mode=https
  /import file-name="$basePath/$fileName"
}
```

## scheduler

```routeros
/system scheduler
add comment="cron: update spamhaus everyday" interval=1d name=spamhaus on-event="/system script run spamhaus" policy=ftp,read,write,policy,test start-date=2025-10-05 start-time=06:00:00
```

## firewall

```routeros
/ip firewall raw
add action=drop chain=prerouting comment="ddosconf: drop all spamhaus (v4)" in-interface-list=WAN log=yes log-prefix="(spamhaus-drop-v4)" src-address-list=spamhaus-drop-v4
```

```routeros
/ipv6 firewall raw
add action=drop chain=prerouting comment="ddosconf: drop all spamhaus (v6)" in-interface-list=WAN log=yes log-prefix="(spamhaus-drop-v6)" src-address-list=spamhaus-drop-v6
```
