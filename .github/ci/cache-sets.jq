# All four published platforms must belong to the same Exact revision and refresh.
[.[][] | select(.draft == false and .prerelease == false) | . as $release
 | .tag_name | capture("^exact-ci-linux-v2-(?<platform>android|ios|macos|web)-(?<exact>[a-f0-9]{40})-(?<run>[0-9]+)-(?<attempt>[0-9]+)$")
 | .platform as $platform
 | select(any($release.assets[]; .name == ("cache-" + $platform + ".tar.zst.part-aaa") and .size > 0 and .state == "uploaded"))
 | {platform, exact, run: (.run|tonumber), attempt: (.attempt|tonumber), tag: $release.tag_name}]
| group_by([.run, .exact])
| map(select((map(.platform)|unique) == ["android","ios","macos","web"]) | sort_by(.attempt)
      | {run: .[0].run, exact: .[0].exact, tags: (map({key: .platform, value: .tag})|from_entries)})
| sort_by(.run) | reverse
