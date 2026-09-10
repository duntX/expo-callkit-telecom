import ExpoModulesCore
import Foundation

struct CallOptions: Equatable {
  var hasVideo: Bool
  var playDialtone: Bool = true
}

struct CallOptionsRecord: Record {
  @Field
  var hasVideo: Bool = false

  @Field
  var playDialtone: Bool = true

  func toModel() -> CallOptions {
    CallOptions(hasVideo: hasVideo, playDialtone: playDialtone)
  }
}
