type Config record {|
    string foo_bar?;
    string fooBar?;
    string? password = ();
    int|string size?;
    float timeout?;
    decimal rate?;
|};

type Pool record {|
    string? password = ();
|};

type Auth record {|
    string token;
|};

type Client record {|
    Auth auth;
    string url?;
    int retries?;
|};

configurable string sharedUrl = ?;
