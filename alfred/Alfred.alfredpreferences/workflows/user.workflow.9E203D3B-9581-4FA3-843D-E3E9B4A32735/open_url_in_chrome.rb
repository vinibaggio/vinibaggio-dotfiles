require 'json'

home = ENV['HOME']
chrome_version = ENV['CHROME_VERSION'] || 'Chrome'
chrome_profile = ENV['CHROME_PROFILE'] || 'Google'
url_to_open = ARGV[0]

def get_profile_with_name(profile_hash, name)
  profile_hash.each do |key, profile|
    return key if profile['name'] == name
    return nil
  end
end

if chrome_version == 'Chrome'
  local_state_file = "#{home}/Library/Application Support/Google/"\
                     "#{chrome_version}/Local State"
  path_to_exec = File.absolute_path('/Applications/'\
                                    "Google\\ #{chrome_version}.app/"\
                                    "Contents/MacOS/Google\\ #{chrome_version}")
end

# Read the config file with information about the available profiles
File.open(local_state_file, 'r') do |f|
  local_state_file = JSON.parse(f.read)
end

profile_info = local_state_file['profile']['info_cache']
profile_name = get_profile_with_name(profile_info, chrome_profile)

exec("#{path_to_exec} --profile-directory=\"#{profile_name}\" #{url_to_open}")
