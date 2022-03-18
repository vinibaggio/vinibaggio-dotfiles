require 'json'

query = ARGV[0] || ''
items = {}

# Make an item to show in the list
def make_item(name, subtitle, arg)
  {
    uid: name,
    title: name,
    subtitle: subtitle,
    arg: arg,
    autocomplete: name
  }
end

# Add an item to the list of results
def add_item(items, name, subtitle = '')
  # Add default subtitle if necessary
  subtitle = "Go to \"go/#{name}\"" if subtitle.empty?
  arg = name.downcase
  ignore_item = !items.key?(name) && !name.empty?

  items[arg] = make_item(name, subtitle, arg) if ignore_item
end

# Build go links form environment config
ENV.each_pair do |key, value|
  next unless key.start_with? 'GO_'

  key = key.sub('GO_', '').downcase
  add_item(items, key, value)
end

# Filter mismatching items
keys = items.keys
keys.each do |key|
  items.delete(key) if key.downcase.index(query.downcase) != 0
end

# Add the query into the list
add_item(items, query, "Go to \"go/#{query}\"")

print JSON.generate(items: items.values)
